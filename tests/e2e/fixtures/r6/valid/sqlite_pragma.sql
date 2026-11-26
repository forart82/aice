PRAGMA foreign_keys = ON;

CREATE TABLE ledger_kv (
  key TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  payload TEXT NOT NULL
) STRICT, WITHOUT ROWID;

SELECT key, seq
FROM ledger_kv
WHERE seq > 0
ORDER BY seq ASC;
