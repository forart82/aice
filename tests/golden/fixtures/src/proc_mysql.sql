DELIMITER //
CREATE PROCEDURE record_invoice(IN p_account_id BIGINT, IN p_total DECIMAL(10,2))
BEGIN
  INSERT INTO invoices (account_id, total_amount)
  VALUES (p_account_id, p_total)
  ON DUPLICATE KEY UPDATE total_amount = p_total;
END //
DELIMITER ;
