# Feature TDD Specification: Game Balance, Bug Fixes & Incoherences Resolution

> **Feature Identifier:** `docs/tdd/game_balance_and_incoherences_resolution.tdd.md`  
> **Status:** Complete / Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Resolution of simulation balance outliers, infinite invulnerability loops, runaway exponential damage, 4x aura multipliers, regenerative tick frequency, helmet thorns scaling, and codex encyclopedia textual incoherences discovered during 8-agent autonomous multi-bot audit.
- **Target Systems:** `src/sim/`, `src/data/`, `src/tests/`, `ORACLE.md`
- **Core Requirements:**
  1. **Shadow Stalker Invulnerability Balance ([`SnakePlayer.ts:1250-1260`](file:///home/forart/dev/snake_ts/src/sim/SnakePlayer.ts#L1250-L1260))**: Calibrated Stalker dash i-frame window to $\min(0.40\text{s}, \max(0.05\text{s}, \text{DashCooldown} \times 0.50 - \text{DashDuration}))$, eliminating 100% perma-invulnerability loops while preserving high agility.
  2. **Infinite Devourer Scaling ([`CombatSystem.ts:384`](file:///home/forart/dev/snake_ts/src/sim/CombatSystem.ts#L384))**: Replaced multiplicative compound $1.05^N$ with linear additive $+5\%$ damage bonus per 5 combo events (`1.0 + devourerStacks * 0.05`), preventing $>7,000,000\text{ DPS}$ overflow on Floor 20.
  3. **Orbital Fangs Damage Parity ([`CombatAuras.ts:122`](file:///home/forart/dev/snake_ts/src/sim/CombatAuras.ts#L122))**: Removed unintended $4\times$ multiplier ($55 \times \text{dt} \times 4$), aligning runtime DPS to documented $55\text{ DPS}$ per blade.
  4. **ComboWindow Multiplier Fallbacks ([`GameData.ts:241, 319`](file:///home/forart/dev/snake_ts/src/data/GameData.ts#L241))**: Corrected fallback values in `serpents_focus` and `combo_surge` from `|| 3.0` to `?? 1.0`.
  5. **Regeneration Tick Alignment ([`SnakePlayer.ts:1135`](file:///home/forart/dev/snake_ts/src/sim/SnakePlayer.ts#L1135))**: Scaled 3.0s periodic regen heal amount by $3\times$ ($\text{HpRegen} \times 3$), aligning actual recovery rate with advertised $+X\text{ HP/s}$ tooltips.
  6. **Helmet Thorns Percentage Normalization ([`Helmets.ts:247, 291`](file:///home/forart/dev/snake_ts/src/data/Helmets.ts#L247))**: Generated helmet thorns as fractional percentages ($0.08–0.25$) formatted as $+X\%\text{ Thorns}$, matching `barbed_scales` ($+40\%$) reflection mechanics.
  7. **Codex & Blueprint Nomenclature Alignment ([`CodexData.ts`](file:///home/forart/dev/snake_ts/src/data/CodexData.ts), [`GameData.ts`](file:///home/forart/dev/snake_ts/src/data/GameData.ts))**: Updated obsolete prototype names, skill blast radii (Umbral Blink 130 AoE, Supernova 260px), and helmet vault rarity affix counts to match simulation reality and SSOT.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** [`src/tests/GameBalanceAndIncoherencesResolution.test.ts`](file:///home/forart/dev/snake_ts/src/tests/GameBalanceAndIncoherencesResolution.test.ts)
- **Assertions:**
  1. Stalker invulnerability window is strictly less than dash cooldown at all sprint gland stack levels.
  2. Infinite devourer damage bonus scales additively ($1.0 + N \times 0.05$).
  3. Orbital fangs blade damage matches $55 \times \text{dt} \times \text{dmgBonus}$.
  4. ComboWindow correctly falls back to 1.0 when uninitialized.
  5. 3.0s periodic regen heals exactly $3 \times \text{HpRegen}$ HP.
  6. Helmet thorns generates between $0.05$ and $0.35$ and formats as $+X\%\text{ Thorns}$.
  7. Blueprint descriptions in `GameData.ts` reference Head offensive weapons and defensive bio-organs.
  8. CodexData has updated skill stats, Arc Drone names, and rarity affix numbers.

---

## 3. Implementation Details (Green Phase)

- **Files Modified:**
  - [`src/sim/SnakePlayer.ts`](file:///home/forart/dev/snake_ts/src/sim/SnakePlayer.ts)
  - [`src/sim/CombatSystem.ts`](file:///home/forart/dev/snake_ts/src/sim/CombatSystem.ts)
  - [`src/sim/CombatAuras.ts`](file:///home/forart/dev/snake_ts/src/sim/CombatAuras.ts)
  - [`src/data/GameData.ts`](file:///home/forart/dev/snake_ts/src/data/GameData.ts)
  - [`src/data/Helmets.ts`](file:///home/forart/dev/snake_ts/src/data/Helmets.ts)
  - [`src/data/CodexData.ts`](file:///home/forart/dev/snake_ts/src/data/CodexData.ts)
  - [`src/tests/GameBalanceAndIncoherencesResolution.test.ts`](file:///home/forart/dev/snake_ts/src/tests/GameBalanceAndIncoherencesResolution.test.ts)
  - [`src/tests/BossHelmetsAndCranialLabSimulationAudit.test.ts`](file:///home/forart/dev/snake_ts/src/tests/BossHelmetsAndCranialLabSimulationAudit.test.ts)
  - [`src/tests/CranialLabAndBossHelmets.test.ts`](file:///home/forart/dev/snake_ts/src/tests/CranialLabAndBossHelmets.test.ts)
  - [`src/tests/CardsAndRelicsIntegrity.test.ts`](file:///home/forart/dev/snake_ts/src/tests/CardsAndRelicsIntegrity.test.ts)
  - [`src/tests/GameBalanceAndSynergyAudit.test.ts`](file:///home/forart/dev/snake_ts/src/tests/GameBalanceAndSynergyAudit.test.ts)

---

## 4. Verification & Quality Check

```bash
./verify
```
**Results:**
- Strict TypeScript Typecheck: 0 errors (100% clean)
- Vitest Test Suites: **101 passed files / 1330 passed tests (100% PASS)**
- Production Bundle Build: 100% PASS
