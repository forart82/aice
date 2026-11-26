PRAGMA foreign_keys = ON;

CREATE TABLE cache_entries (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

INSERT INTO cache_entries (cache_key, payload, updated_at)
VALUES ('k1', 'v1', 100)
ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload;
