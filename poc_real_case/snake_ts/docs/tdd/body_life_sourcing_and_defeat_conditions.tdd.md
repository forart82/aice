# Feature TDD Specification: Body Life Sourcing & Serpentine Defeat Conditions

> **Feature Identifier:** `docs/tdd/body_life_sourcing_and_defeat_conditions.tdd.md`  
> **Status:** Green (Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** 
  The serpentine organism treats its body segments as an active, vital reservoir of life. The head has its own dedicated health pool (`HeadHp`, `HeadMaxHp`). When the head suffers damage from enemy bites, boss strikes, projectiles, or hazards, life is dynamically sourced starting from the posterior-most segment (the tail). That last body part absorbs the damage; if its health drops to $\le 0$, it is consumed/severed and the damage cascade continues forward through preceding segments until all incoming damage is absorbed or no body segments remain. Only when the serpent has **zero remaining body segments** (`Segments.length === 0`) **AND** its head health is reduced to **zero or less** (`HeadHp <= 0`) does the snake die (`Alive = false`).
- **Target Systems:**
  - `src/sim/SnakePlayer.ts`: `DamageHead`, `TakeDamage`, `SeverFrom`, `Hp`, `MaxHp`, `Alive`
  - `src/sim/GameEngine.ts`: Game over evaluation rules
  - `ORACLE.md`: Update Section 3.5 Head Destruction & Defeat Condition
- **User Directive:**
  > *"we must handle live better! for this the head as it owen has health but the whole body is a source of life. if the head gets damaged then we ill start sourcing life from the last body part until there is no more bodypart. so the snake only dies if there is no more body parts and the head is 0 or less life"*

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/BodyLifeSourcingAndDefeat.test.ts`
- **Assertions:**
  1. `1.1 head damage sources life from the last body segment when segments exist`:
     When a snake with segments takes damage to the head, the last segment (`Segments[N-1]`) loses health while `HeadHp` remains intact. (**PASSED**)
  2. `1.2 cascading damage consumes multiple posterior segments from tail forward`:
     When incoming head damage exceeds the last segment's HP, the last segment is popped off and the excess damage continues absorbing from the new last segment. (**PASSED**)
  3. `1.3 snake remains alive when all body parts are severed if headHp > 0`:
     Severing all body segments (`Segments.length === 0`) does not kill the snake if `HeadHp > 0`. The lone head continues surviving. (**PASSED**)
  4. `1.4 damage applies to headHp only when no body segments remain (or after all segments are consumed)`:
     When `Segments.length === 0`, incoming damage subtracts directly from `HeadHp`. (**PASSED**)
  5. `1.5 snake dies strictly when segments === 0 and headHp <= 0`:
     The snake's `Alive` state transitions to `false` only when `Segments.length === 0 && HeadHp <= 0`. (**PASSED**)
  6. `1.6 TakeDamage also sources life from the last body segment`:
     General damage to the player through `TakeDamage` sources from the last body part forward instead of severing the entire snake from segment 0. (**PASSED**)

---

## 3. Implementation Details (Green Phase)

- **Files Modified:**
  - `src/sim/SnakePlayer.ts`:
    - Refactored `DamageHead` to source life starting from `this.Segments[this.Segments.length - 1]` forward.
    - Refactored `TakeDamage` to source life starting from `this.Segments[this.Segments.length - 1]` forward.
    - Updated `SeverFrom` so that losing all segments does not kill the player if `this.HeadHp > 0`.
    - Updated death condition in all damage pipelines: `this.Segments.length === 0 && this.HeadHp <= 0`.
  - `src/sim/GameEngine.ts`:
    - Verified death checks respect `!player.Alive || (player.Segments.length === 0 && player.HeadHp <= 0)`.
  - `ORACLE.md`:
    - Updated Section 3.5 to reflect the body life sourcing mechanism and the new defeat condition.
  - `src/tests/SegmentHealthAndXp.test.ts`:
    - Updated Tests 3, 5, 8, 9, 10, 18 to align with the new body life sourcing standard.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/BodyLifeSourcingAndDefeat.test.ts
npx vitest run src/tests/SegmentHealthAndXp.test.ts
npm run typecheck
./verify
```

