CREATE OR REPLACE FUNCTION credit_account(p_id BIGINT)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE accounts SET balance = WHERE id = p_id;
  IF v_balance IS NULL
    RETURN 0;
  END IF;
END;
$$;
