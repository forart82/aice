DELIMITER //

CREATE PROCEDURE upsert_ledger_entry(IN p_id BIGINT)
BEGIN
  INSERT INTO accounts (id, balance) VALUES (p_id, )
  ON DUPLICATE KEY UPDATE balance = ;
END //

DELIMITER ;
