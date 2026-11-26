PRAGMA foreign_keys = ;

CREATE TABLE ledger_kv (
  key TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
) STRICT;
