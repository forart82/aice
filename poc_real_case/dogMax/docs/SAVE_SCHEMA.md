# 💾 Save Schema & Migration Specification

> **Rule Reference:** `AGENTS.md#rule-12`

## ⚠️ STATUS: NO SAVE SYSTEM EXISTS

dogmax currently persists nothing. There is no save file, no progression store
and no settings persistence beyond the config override sidecar.

This rule is therefore **binding from the moment persistence is added**, and this
document is the specification that work must satisfy — not a description of
something that exists.

## 1. Mandatory schema envelope

Every persisted document carries an explicit integer version as its first field:

```
schemaVersion: 1
```

A loader that encounters an unknown or missing version **fails loudly** rather
than guessing, matching the config layer's crash-early rule. Silently accepting
an unrecognised save is how player progress gets corrupted.

## 2. Migration contract

- Every schema change ships a migration function `migrateVFromTo(N, N+1)`.
- Migrations are **pure and chainable**: loading a v1 file in a v4 build runs
  1→2→3→4 in order.
- Every migration ships a test in `tests/core/save_migration_test.cpp` that loads
  a **frozen fixture** of the old format and asserts the migrated result.
- A fixture is never regenerated to make a test pass. That is Rule 4 tampering —
  the fixture *is* the old player's file.

## 3. Candidate persisted state

When persistence is built, the following are the likely contents. Each needs its
own TDD spec entry:

| Field | Type | Notes |
| :--- | :--- | :--- |
| `schemaVersion` | int | Always first |
| `heroLevel` | int | Distance-derived |
| `cumulativeDistance` | float | Drives levelling |
| `inventory[]` | list | Weapons and dice with quality + item level |
| `weaponSlots[]` | list | Equipped rows and slotted dice |
| `powder` | map | Per-colour counts |
| `settings` | map | Volume, zoom, key bindings |
| `runSeed` | uint64 | Enables exact replay of a run |

`runSeed` is worth persisting specifically because the RNG is bit-reproducible —
storing it makes a bug report replayable, which is worth more than most telemetry.

## 4. Privacy (Rule 7)

Saves are local files. No account, no server, no analytics without explicit
opt-in consent. GDPR/COPPA/CCPA compliance is trivial to keep while that remains
true, and easy to lose the moment it does not.
