# Feature TDD Specification: [Feature Name]

- **Feature Identifier:** `[feature_slug]`
- **Oracle Reference:** `ORACLE.md#[section_anchor]`
- **Target Component:** `[src/path/to/Component.hpp]`
- **Test File Path:** `[tests/area/component_test.cpp]`
- **Status:** `[DRAFT | RED (Failing) | GREEN (Passing) | REFACTORED]`

---

## 1. Feature Specification (What it does)

### 1.1 Summary & Business Objective
[Clear, unambiguous explanation of the feature, why it is needed, and its functional purpose in the game. Must align with ORACLE.md.]

> Domain code under test must be free of SFML types in its header (Rule 6), or it cannot run headlessly.

### 1.2 Functional Requirements
- **FR-1:** [Requirement 1 description]
- **FR-2:** [Requirement 2 description]
- **FR-3:** [Requirement 3 description]

### 1.3 Inputs & Outputs
- **Inputs:** [Parameters, event payloads, delta time, player actions]
- **Outputs:** [Return values, state transitions, emitted events, updated entity stats]

### 1.4 Invariants & Edge Cases
- **Edge Case 1:** [Zero, negative, max limits, boundary conditions]
- **Edge Case 2:** [Null/undefined, unexpected states, uninitialized values]
- **Edge Case 3:** [Frame drops / high delta time handling]

---

## 2. Test Strategy (How it will be tested)

### 2.1 Test Environment & Harness
- **Framework:** doctest (MIT, header-only)
- **Mocks & Stubs:** [Seeded DeterministicRandom, fixed dt, hand-built ConfigLoader — never a real window or GL context]
- **Execution Command:** `ctest --test-dir build-test -R [test_name] --output-on-failure`

### 2.2 Test Case Matrix

| Test ID | Category | Scenario / Description | Test Method Name |
| :--- | :--- | :--- | :--- |
| **TC-01** | Happy Path | Standard valid scenario | `test_should_...` |
| **TC-02** | Happy Path | Secondary valid scenario | `test_should_...` |
| **TC-03** | Boundary | Min / Max bounds handling | `test_should_clamp_...` |
| **TC-04** | Error / Edge | Invalid input / unexpected state | `test_should_handle_...` |

---

## 3. Expected Results & Assertions (What are the results)

### 3.1 Scenario Assertions Matrix

| Test ID | Input / Setup | Execution Call | Expected Output / State Assertion |
| :--- | :--- | :--- | :--- |
| **TC-01** | Initial valid state | `method(params)` | Returns expected output; state updated per ORACLE.md |
| **TC-02** | Specific state condition | `method(params)` | Expected event emitted / value returned |
| **TC-03** | Boundary inputs | `method(params)` | Clamped to min/max threshold |
| **TC-04** | Invalid input | `method(params)` | Throws error or fails safely with fallback |

---

## 4. Execution Log & Validation Proof

### 4.1 RED Phase Execution (Initial Failure Confirmation)
- **Execution Date/Time:** `YYYY-MM-DD HH:MM:SS`
- **Command:** `ctest --test-dir build-test -R [test_name] --output-on-failure`
- **Output:**
```text
[Paste terminal failure trace here demonstrating test failed for expected reason]
```

### 4.2 GREEN Phase Execution (Passing Confirmation)
- **Execution Date/Time:** `YYYY-MM-DD HH:MM:SS`
- **Command:** `ctest --test-dir build-test -R [test_name] --output-on-failure`
- **Output:**
```text
[Paste terminal passing output here confirming all tests passed]
```

### 4.3 Refactor Verification & Regression Sweep
- **Full Suite Command:** `./verify`
- **Result:** `ALL X TESTS PASSED across entire repository`
- **Sign-off Status:** `APPROVED & VERIFIED`
