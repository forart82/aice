# 💾 Save Schema Specification & Migration Protocol

> **Rule Reference:** [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Storage Keys:** `ouroboros_meta_v2` (Current), `ouroboros_meta_v1` (Legacy)  
> **Target Directory:** `/home/forart/dev/snake_ts`  

---

## 🗄️ 1. Version 2 Schema (Active)

```json
{
  "version": 2,
  "shards": 450,
  "unlockedClasses": {
    "emerald": true,
    "stalker": true,
    "hydra": false,
    "storm": false,
    "solar": false
  },
  "upgrades": {
    "vitality": { "level": 2 },
    "agility": { "level": 1 },
    "ferocity": { "level": 0 },
    "resilience": { "level": 0 },
    "magnet": { "level": 1 },
    "swiftness": { "level": 0 },
    "rerolls": { "level": 0 },
    "fortune": { "level": 0 },
    "greed": { "level": 0 }
  },
  "records": {
    "highestFloor": 4,
    "highestScore": 128400,
    "highestCombo": 38,
    "bossesKilled": 3,
    "runsCompleted": 1
  },
  "checksum": "a8f3b92c"
}
```

---

## 🔄 2. Migration Protocol (v1 -> v2)

When an existing user with legacy v1 storage boots the game:
1. `SaveIO` detects presence of `ouroboros_meta_v1`.
2. Migrates legacy `shards` balance and `unlockedClasses` dictionary into v2 structure.
3. Automatically maps integer upgrade counters to `{ level: N }` upgrade objects.
4. Generates CRC32 checksum and saves to `ouroboros_meta_v2`.
5. Removes legacy v1 key.

Tested and verified in [`src/tests/SaveIO.test.ts`](file:///home/forart/dev/snake_ts/src/tests/SaveIO.test.ts).
