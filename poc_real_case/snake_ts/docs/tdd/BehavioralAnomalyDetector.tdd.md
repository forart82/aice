# Feature TDD Specification: Behavioral Anomaly Tracer & Detector

> **Feature Identifier:** `docs/tdd/BehavioralAnomalyDetector.tdd.md`  
> **Status:** Refactored / Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Real-time behavioral anomaly tracer, detector, and telemetry auditor for autonomous bot players in *Ouroboros Ascension*.
- **Target Systems:**
  - `src/sim/ai/BehavioralAnomalyDetector.ts` (Core anomaly detection rules, kinematics trace, corrective action dispatch).
  - `src/sim/ai/BotTelemetryLogger.ts` (Telemetry event records, anomaly aggregations, multi-format summary reports).
  - `src/sim/ai/index.ts` (Public export barrel).
- **Anomaly Detection Rules**:
  1. `ANOMALY_SELF_TRAP`: Bot steering directly into its own trailing body segments when alternative open trajectory angles exist.
  2. `ANOMALY_HAZARD_SUICIDE`: Bot pathing directly into active laser beams, magma tiles, or lethal hazard zones.
  3. `ANOMALY_HOARDING`: Bot holding $\ge 60$ Ouro with unlocked, affordable cranial mutation upgrades without executing purchases for $> 20$ seconds.
  4. `ANOMALY_WASTED_ABILITY`: Bot triggering Dash or Class Skill when threat density in vicinity is zero ($0$ enemies, bosses, or incoming projectiles).
  5. `ANOMALY_POTION_NEGLIGENCE`: Bot steering away from or ignoring health potions within $\le 200\text{px}$ while HP is critically low ($< 35\%$).
- **Real-Time Telemetry Logging**:
  - Anomaly event structure: `timestamp`, `type`, `severity` (`LOW`, `MEDIUM`, `CRITICAL`), `position` (`{ x, y }`), `details`, and `correctiveAction`.
  - Comprehensive anomaly summary section in `BotTelemetryLogger.generateSummaryReport()` (Markdown, ASCII text, and JSON).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/BehavioralAnomalyDetector.test.ts`
- **Assertions:**
  1. **Self-Trap Detection (`ANOMALY_SELF_TRAP`)**: Triggers `CRITICAL` anomaly when heading into body segments with open exit corridors available; generates corrective diversion vector.
  2. **Hazard Suicide Detection (`ANOMALY_HAZARD_SUICIDE`)**: Triggers `CRITICAL`/`MEDIUM` anomaly when pathing into active hazards or laser beams; applies repulsive avoidance vector.
  3. **Ouro Hoarding Detection (`ANOMALY_HOARDING`)**: Triggers `MEDIUM` anomaly after $> 20$ seconds of holding $\ge 60$ Ouro with affordable unlocked upgrades; resets timer on purchase.
  4. **Wasted Ability Detection (`ANOMALY_WASTED_ABILITY`)**: Triggers `LOW` anomaly when dash or skill is activated in an empty area with zero nearby hostiles.
  5. **Potion Negligence Detection (`ANOMALY_POTION_NEGLIGENCE`)**: Triggers `CRITICAL` anomaly when serpent HP $< 35\%$ and bot fails to steer towards a health potion within $200\text{px}$; overrides steering towards potion.
  6. **Telemetry & Summary Reporting**: Records events in `BotTelemetryLogger`, tracks counts by severity and type, and formats comprehensive Markdown, Text, and JSON anomaly summaries.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/ai/BehavioralAnomalyDetector.ts`: Complete detector implementation with 5 anomaly rules, raycast open corridor detection, hazard repulsion, hoarding timer tracking, ability vicinity auditing, and health potion proximity checks.
  - `src/sim/ai/BotTelemetryLogger.ts`: Added anomaly event ledger, severity count aggregations, and markdown/text/JSON reporting.
  - `src/sim/ai/index.ts`: Exported `BehavioralAnomalyDetector` module.
  - `src/tests/BehavioralAnomalyDetector.test.ts`: 18 tests validating all rules and reporting channels.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/BehavioralAnomalyDetector.test.ts
npm run typecheck
```

**Results:**
- `src/tests/BehavioralAnomalyDetector.test.ts`: 18/18 tests PASS (100%).
- `npm run typecheck`: 0 errors.
