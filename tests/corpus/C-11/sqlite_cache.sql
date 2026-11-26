PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE kv_cache (
    cache_key TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID, STRICT;

CREATE INDEX idx_kv_cache_expiry ON kv_cache (expires_at);

INSERT INTO kv_cache (cache_key, payload_json, expires_at, hits)
VALUES ('merchant:m_01', '{"tier":"pro"}', 1764100000, 1)
ON CONFLICT(cache_key) DO UPDATE SET
    payload_json = excluded.payload_json,
    expires_at = excluded.expires_at,
    hits = kv_cache.hits + 1;

CREATE TABLE rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    tokens_remaining INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) WITHOUT ROWID, STRICT;

DELETE FROM kv_cache
WHERE expires_at < 1764000000;

SELECT cache_key, hits
FROM kv_cache
WHERE hits > 0
ORDER BY hits DESC
LIMIT 20;
