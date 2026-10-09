# Feature TDD Specification: SaveIO Storage Resilience, Migration & Quota Defense

> **Feature Identifier:** `docs/tdd/save_io_storage_resilience_and_migration.tdd.md`  
> **Status:** Green / Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md#section-10`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive defect resolution and resilience hardening across `SaveIO.ts`, `MetaProgression.ts`, and `CompanionSync.ts`. Eliminates data loss of `ouro` and `prestigeMultiplier`, ensures NaN-immune v1->v2 migrations, enables comprehensive CRC32 checksum protection across all game state fields with rolling backup recovery, handles mobile/private browsing `QuotaExceededError` with emergency legacy store pruning and memory fallback, and hardens isolated and wire communications against corrupted payloads.
- **Target Systems:** `src/platform/SaveIO.ts`, `src/data/MetaProgression.ts`, `src/platform/CompanionSync.ts`.
- **Oracle Reference:** [`ORACLE.md#section-10`](file:///home/forart/dev/snake_ts/ORACLE.md) (Galaxy Jump, Ouro Currency, Prestige Multipliers, Unique Helmets).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** [`src/tests/SaveIOResilienceAndMigrationAudit.test.ts`](file:///home/forart/dev/snake_ts/src/tests/SaveIOResilienceAndMigrationAudit.test.ts)
- **Assertions:**
  1. **Ouro & PrestigeMultiplier Integrity:** Preserves `ouro` and `prestigeMultiplier` across save/load cycles and normalizes missing, negative, or NaN values.
  2. **Schema Migration (v1 -> v2) Hardening:** Safely migrates legacy saves containing NaN, Infinity, negative values, and malformed strings without producing NaN in upgrades or records.
  3. **CRC32 Checksum Integrity:** Checks comprehensive payload (including `ouro`, `prestigeMultiplier`, `helmets`, and `uniqueHelmets`) and verifies that payload tampering triggers clean starter state fallback without corrupting game memory.
  4. **Automatic Rolling Backup Recovery:** Automatically falls back to `ouroboros_meta_backup` if primary `ouroboros_meta_v2` is truncated or corrupted.
  5. **Storage Quota Exceeded (QuotaExceededError):** Automatically prunes legacy `ouroboros_meta_v1` on `QuotaExceededError` and retries; falls back gracefully to in-memory store if storage is permanently locked without throwing unhandled exceptions.
  6. **Isolated MetaProgression Backend Hardening:** Gracefully handles malformed or truncated JSON from custom backend and normalizes input structures through `SaveIO.validateAndNormalizeV2`.
  7. **CompanionSync Wire Safety:** Ensures `CompanionSync` ignores null/non-object/invalid wire payloads without throwing TypeErrors, and broadcasts `ouro` and `equippedHelmetId` in `HUD_SYNC`.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - [`src/platform/SaveIO.ts`](file:///home/forart/dev/snake_ts/src/platform/SaveIO.ts): Added `ouro: 0` and `prestigeMultiplier: 1.0` to `createDefaultMetaSave` and `validateAndNormalizeV2`; added `STORAGE_KEY_BACKUP`; added `isQuotaExceededError`; updated `writeKey` with emergency v1 eviction; enhanced `migrateV1toV2` with `Number.isFinite` sanitization; introduced `computeCanonicalChecksumPayload` and `computeLegacyChecksumPayload` for backward-compatible comprehensive CRC32 verification; implemented rolling backup save/load recovery.
  - [`src/data/MetaProgression.ts`](file:///home/forart/dev/snake_ts/src/data/MetaProgression.ts): Wrapped custom `saveBackend` and `_privateMemoryStore` reads in try/catch; routed parsed payloads through `SaveIO.validateAndNormalizeV2`; clamped `this.Shards` to non-negative finite integers.
  - [`src/platform/CompanionSync.ts`](file:///home/forart/dev/snake_ts/src/platform/CompanionSync.ts): Added `ouro` and `equippedHelmetId` to `DesktopHudSyncMessage`; added defensive object/type checks in `onWireMessage` and `handleSignalingMessage`; wrapped `send` in try/catch.
  - [`src/tests/SaveIOResilienceAndMigrationAudit.test.ts`](file:///home/forart/dev/snake_ts/src/tests/SaveIOResilienceAndMigrationAudit.test.ts): 11 exhaustive unit test cases covering all defects.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SaveIOResilienceAndMigrationAudit.test.ts
npx vitest run src/tests/SaveIO* src/tests/MetaProgression.test.ts
```
Results: 100% PASS across all 28 persistence tests with zero errors.
