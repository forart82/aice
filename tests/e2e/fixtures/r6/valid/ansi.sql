CREATE TABLE accounts (
  id BIGINT PRIMARY KEY,
  owner_name VARCHAR(120) NOT NULL,
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00
);

WITH active_accounts AS (
  SELECT id, owner_name, balance
  FROM accounts
  WHERE balance > 0
)
SELECT id, owner_name, balance
FROM active_accounts
ORDER BY balance DESC;
