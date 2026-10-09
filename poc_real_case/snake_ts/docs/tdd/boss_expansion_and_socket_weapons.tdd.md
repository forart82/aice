# Feature TDD Specification: 5-Floor Boss Expansion & Advanced Socket Modules

> **Feature Identifier:** `boss_expansion_and_socket_weapons`  
> **Status:** Completed (100% Green & Verified)  
> **Target Version:** 3.0  
> **Authoritative Standard:** `ORACLE.md` & `AGENTS.md`  

---

## 1. Requirement & Goal
1. Expand boss guardian roster from 3 to 5 unique colossal multi-phase bosses:
   - Floor 1: `centipede` (Centipede Behemoth) — Spreads venom arcs and chases with body segments.
   - Floor 2: `gorgon` (Storm Gorgon / Volt Sovereign) — Rotating tri/quad lightning beams and thunder discharge hazards.
   - Floor 3: `colossus` (Infernal Colossus) — High-density bullet rings and meteor impact craters.
   - Floor 4: `frostwyrm` (Glacial Behemoth / Cryo Wyrm) — Frost crystal barrages, chill debuffs, and permafrost fissures.
   - Floor 5: `leviathan` (Astral Leviathan) — Cosmic vortex spirals and phase 2 homing torpedoes.
2. Add new tactical socket weapons and defense modules to the Snake Lab:
   - Offense: `tachyon` (Tachyon Beam Laser), `cryo` (Cryo Mortar), `plasma` (Plasma Mortar).
   - Defense: `chrono` (Chrono Ward), `nanite` (Nanite Swarm).
3. Integrate persistent Sanctuary blueprint unlocks (`unlock_tachyon`, `unlock_cryo`, `unlock_plasma`, `unlock_chrono`, `unlock_nanite`) using Essence Shards (💎).
4. Resolve critical simulation and render bugs (Burn DoT kill handling, Segment Socket double-update elimination, AudioContext unification, screen-shake matrix decoupling).

---

## 2. Test Cases & Verification Results
- `SelfTest`: `expect(GameData.Bosses.length).toBe(5)` -> **PASS**
- `SelfTest`: `expect(GameData.Bosses.map(b => b.Type)).toEqual(['centipede', 'gorgon', 'colossus', 'frostwyrm', 'leviathan'])` -> **PASS**
- `SelfTest`: Validate slot categories for all 13 tactical offense & defense modules -> **PASS**
- `SelfTest`: Validate `MetaProgression.IsModuleUnlocked()` with persistent defaults and unlocks -> **PASS**
- `SelfTest`: Vector zero division and hazard telegraph max ratios -> **PASS**
- **Quality Gate `./verify`:** 119/119 Vitest tests passing, TypeScript 0 errors, Production build successful.
