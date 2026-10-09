# Feature TDD Specification: Arsenal, Bosses & Human-like Playtest Deep Audit

> **Feature Identifier:** `docs/tdd/arsenal_bosses_and_playtest_audit.tdd.md`  
> **Status:** Green & Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](../AGENTS.md) & [`ORACLE.md`](../ORACLE.md)  

---

## 1. Feature Overview & Audit Scope

### 1.1 Complete 16 Offense Modules & 12 Defense Modules
- **16 Modular Weapons**:
  - Kinetic: `turret` (Attack Spitter), `flak` (Railgun Flak Cannon), `scattershot` (Scattershot Blunderbuss), `needler` (Seeker Needler), `mortar` (Cluster Mortar), `sonic` (Sonic Prow Cannon), `gatling` (Rotary Minigun), `caltrop` (Caltrop Dropper).
  - Elemental: `tesla` (Bio-Arc Coil), `magma` (Magma Vent), `cryo` (Cryo Mortar), `venom` (Venom Sprayer), `tachyon` (Tachyon Laser), `plasma` (Plasma Arc Cannon), `singularity` (Singularity Vortex Gun), `solar` (Solar Flare Mortar).
- **12 Defensive Systems**:
  - `shield` (Carapace Shield), `spikes` (Thorny Spine Armor), `regen` (Regen Gland), `magnet` (Bio-Magnet), `chrono` (Chrono Ward), `nanite` (Nanite Swarm), `reactive` (Reactive Blast Plating), `magnetic_aegis` (Magnetic Aegis), `cryo_carapace` (Cryo Frost Carapace), `heatsink` (Volcanic Heat Sink), `cloak` (Phase Cloak Emitter), `emp_coil` (EMP Discharge Coil).

### 1.2 The 28 Master Alchemical Cross-Module Fusions Matrix
- `superconductor` (Superconductor Surge), `obsidian` (Obsidian Armor), `miasma` (Miasma Combustion), `prismatic` (Prismatic Aegis), `temporal_singularity` (Temporal Singularity), `railgun_flak` (Railgun Flak Battery), `glacial_rot` (Glacial Rot), `thermobaric_mortar` (Thermobaric Mortar), `event_horizon` (Event Horizon Web), `biosteel_quill` (Biosteel Quill Burst), `tachyon_overcharge` (Tachyon Overcharge), `sublimation_shock` (Sublimation Shock), `corrosive_needle` (Corrosive Needle Carapace), `photon_mirror` (Photon Mirror Barricade), `nanite_plague` (Nanite Plague Vector), `kinetic_bastion` (Kinetic Bastion Discharge), `entropic_miasma` (Entropic Miasma), `cryo_barrier` (Cryo-Barrier Reflection), `volcanic_bulwark` (Volcanic Bulwark), `auto_fabricator` (Auto-Fabricator Turrets), `tachyon_stutter` (Tachyon Stutter Beam), `absolute_zero` (Absolute Zero Stasis), `electrified_hull` (Electrified Hull), `pyro_nanite` (Pyro-Nanite Swarm), `thermal_ray` (Thermal Ray Needle), `tesla_nanite` (Tesla Nanite Cloud), `cryo_tachyon` (Cryo-Tachyon Lance), `chrono_accelerator` (Chrono Dart Accelerator).

### 1.3 8 Apex Boss Guardians & Multi-Phase Encounters
- All 8 bosses: `centipede` (Centipede Behemoth), `gorgon` (Storm Gorgon), `colossus` (Infernal Colossus), `frostwyrm` (Glacial Behemoth), `chronowyrm` (Chrono Wyrm), `hivemind` (Bio-Venom Hivemind), `superconductor_boss` (Apex Superconductor), `leviathan` (Astral Leviathan).
- Multi-phase state machine ($\le 50\%$ HP triggers Phase 2), bullet hell patterns, signature environmental hazards (meteors, lasers, frost fields, chrono zones, toxic geysers, lightning grids).

### 1.4 6 Enemy Types & AI Behaviors
- `scarab` (Blob / basic crawler), `swarmling` (Fast swarmer with sinusoidal wobble), `spitter` (Ranged spitter maintaining standoff range), `phantom` (Burrower / weaver with orthogonal sinusoidal weave), `drone` (Hovering flyer with 3-shot spread volley), `brute` (Charger with windup telegraph shockwave and high-speed tackle).

### 1.5 Human-like AI Playtest Probes
- 20-seed sweeps across all 5 serpent classes (Emerald Viper, Shadow Stalker, Hydra Behemoth, Storm Wyrm, Solar Drake) simulating human steering, dodging, combat, food gathering, socketing, and boss fights with $\ge 60\%$ boss reach rate, $\ge 50\%$ Boss 1 kill rate, and $\ge 40\text{s}$ average survival.

---

## 2. Test Plan (Red-Green-Refactor)

- **Test Files:**
  - `src/tests/ArsenalExpansion.test.ts`
  - `src/tests/ApexBossGuardians.test.ts`
  - `src/tests/WeaponsAndDefensePlaytest.test.ts`
  - `src/tests/PlayTest.test.ts`
