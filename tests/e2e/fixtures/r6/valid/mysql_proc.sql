DELIMITER //

CREATE PROCEDURE upsert_ledger_entry(IN p_id BIGINT, IN p_owner VARCHAR(120), IN p_delta DECIMAL(12, 2))
BEGIN
  INSERT INTO accounts (id, owner_name, balance)
  VALUES (p_id, p_owner, p_delta)
  ON DUPLICATE KEY UPDATE
    balance = balance + VALUES(balance);
END //

DELIMITER ;
