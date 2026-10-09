# Feature TDD Specification: Platform Persistence & MultiScreen Consolidation (Merge Proposition 6)

> **Feature Identifier:** `docs/tdd/platform_persistence_and_multiscreen_consolidation.tdd.md`  
> **Status:** Green (100% Conformance Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Centralize all platform persistence (save serialization, schema v1->v2 migrations, CRC32 checksum generation & verification, corruption fallbacks, JSON/Base64 import/export) strictly in `SaveIO.ts`. Refactor `MetaProgression.ts` to consume `SaveIO.loadMeta()` and `SaveIO.saveMeta()`. Consolidate `MultiScreenSync.ts` into `src/platform/MultiScreen.ts` with a unified packet envelope across local `BroadcastChannel` (`ouroboros_multiscreen_v1`) and wireless WebRTC `CompanionSync.ts`. Update `MultiScreenModal.ts` to directly consume `MultiScreenManager` and `CompanionSync`.
- **Target Systems:**
  - `src/platform/SaveIO.ts`: Central persistence hub, Schema v1->v2 migrations, CRC32 checksums, export/import JSON and Base64 envelopes, corruption resilience.
  - `src/data/MetaProgression.ts`: Refactored to delegate persistence entirely to `SaveIO.loadMeta()` and `SaveIO.saveMeta()`.
  - `src/platform/MultiScreen.ts`: Consolidated multi-screen manager, unified packet schema, role negotiation, leader election, and test bus for headless testing.
  - `src/multiscreen/MultiScreenSync.ts`: Backward compatibility proxy re-exporting from `src/platform/MultiScreen.ts`.
  - `src/platform/CompanionSync.ts`: WebRTC DataChannel & WebSocket relay fallback, room pairing code generation, mobile companion QR link, latency ping/pong.
  - `src/ui/screens/MultiScreenModal.ts`: UI modal consuming `MultiScreenManager` and `CompanionSync` for popout secondary displays and mobile companion controller pairing.
- **Mechanics Reference:** [`ORACLE.md#platform-architecture`](file:///home/forart/dev/snake_ts/ORACLE.md) & [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/PlatformPersistenceAndMultiScreenConsolidation.test.ts`
- **Assertions:**
  1. **SaveIO Centralized Persistence & Normalization**:
     - Serializes complete game meta state (shards, unlocked classes, upgrades, unlocked modules, unlocked tiers, completed challenges, records, helmets, equipped helmet ID, daily capacity state).
     - Validates and normalizes malformed / partial objects without data loss.
     - Computes CRC32 checksums on save payloads and verifies integrity on load.
  2. **Schema v1 -> v2 Automatic Migration**:
     - Migrates legacy flat v1 structures (unlocked classes array, numeric upgrade levels, legacy record keys) into structured v2 schema.
     - Correctly cleans up legacy keys and persists updated v2 schema to storage.
  3. **Corrupt Payload & Error Resilience**:
     - Handles corrupted JSON strings, non-object JSON, and truncated data gracefully by falling back to sane defaults without throwing exceptions.
     - Tracks last error in `SaveIO.lastError` for diagnostic visibility.
  4. **Save Export & Import (JSON & Base64 Envelopes)**:
     - Exports signed envelopes with `OUROBOROS_SAVE` header, timestamp, and CRC32 checksum.
     - Imports valid JSON and Base64 payloads, rejecting corrupted payloads or mismatched checksums.
  5. **MetaProgression Delegation to SaveIO**:
     - `MetaProgression.load()` loads from `SaveIO.loadMeta()`.
     - `MetaProgression.save()` persists via `SaveIO.saveMeta()`.
     - `MetaProgression.reset()` delegates to `SaveIO.resetMeta()`.
     - Buying upgrades, unlocking classes, adding helmets, and committing runs persist seamlessly via `SaveIO`.
  6. **Unified MultiScreen Packet Schema & MultiScreenManager**:
     - Standard envelope format (`type`, `senderId`, `role`, `timestamp`, `payload`).
     - Supports all roles: `primary`, `secondary`, `companion`, `hud`, `minimap`, `sanctuary`, `inventory`, `spectator`, `controller`, `display`.
     - Broadcasts `GAME_STATE_SYNC` / `SYNC_STATE`, `INPUT_EVENT` / `CONTROLLER_INPUT`, `MINIMAP_SYNC`, `DRAFT_SELECT`, and `PAUSE_TOGGLE`.
     - Heartbeat and stale window detection / cleanup.
     - Test bus enables headless deterministic testing between multiple window instances.
  7. **CompanionSync WebRTC & Relay Integration**:
     - Generates 6-character room codes (format: `XXX-XXX`) and valid mobile companion pairing URLs.
     - Handles bidirectional message exchange: controller inputs, HUD state sync, card draft selections, and ping/pong latency measurement.
  8. **MultiScreenModal Integration**:
     - Instantiates `MultiScreenManager` and `CompanionSync`.
     - Displays formatted companion URL with generated room code.
     - Forwards companion inputs to the active engine instance.
     - Handles popout window spawning cleanly.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `docs/tdd/platform_persistence_and_multiscreen_consolidation.tdd.md` (Specification)
  - `src/tests/PlatformPersistenceAndMultiScreenConsolidation.test.ts` (Vitest Test Suite: 18 tests)
  - `src/platform/SaveIO.ts` (Centralized Persistence, Schema Migration, CRC32, Export/Import)
  - `src/data/MetaProgression.ts` (Refactored to delegate to SaveIO)
  - `src/platform/MultiScreen.ts` (Consolidated MultiScreenManager, Unified Packet Schema, TestBus)
  - `src/multiscreen/MultiScreenSync.ts` (Consolidated proxy re-exporting from `src/platform/MultiScreen.ts`)
  - `src/platform/CompanionSync.ts` (Refined unified packet alignment)
  - `src/ui/screens/MultiScreenModal.ts` (Consumes MultiScreenManager & CompanionSync)

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/PlatformPersistenceAndMultiScreenConsolidation.test.ts
# ✓ 18 tests passed (100% PASS)

npx vitest run src/tests/SaveIO.test.ts src/tests/MultiScreen.test.ts src/tests/Platform.test.ts src/tests/GalaxyMainMenuAndMultiScreen.test.ts src/tests/PlatformAndUiIntegrity.test.ts src/tests/PlatformPersistenceAndMultiScreenConsolidation.test.ts
# ✓ 55 tests passed (100% PASS)

npx tsc --noEmit
# ✓ 0 TypeScript errors (100% clean check)
```
