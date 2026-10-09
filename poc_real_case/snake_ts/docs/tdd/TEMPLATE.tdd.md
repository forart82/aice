# Feature TDD Specification: [Feature Name]

> **Feature Identifier:** `docs/tdd/<feature_name>.tdd.md`  
> **Status:** [Draft / Red / Green / Refactored]  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** [Brief description of the feature]
- **Target Systems:** [e.g. `src/sim/`, `src/render/`, `src/ui/`, `src/audio/`]
- **Mechanics Reference:** [`ORACLE.md#section`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/<feature>.test.ts`
- **Assertions:**
  1. [Assertion 1]
  2. [Assertion 2]

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/path/to/File.ts`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/<feature>.test.ts
npm run typecheck
```
