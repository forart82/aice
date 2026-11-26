CREATE OR REPLACE FUNCTION credit_account(p_id BIGINT, p_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  UPDATE accounts
  SET balance = balance + p_amount
  WHERE id = p_id
  RETURNING balance INTO v_balance;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Account % not found', p_id;
  END IF;

  RETURN v_balance;
EXCEPTION
  WHEN numeric_value_out_of_range THEN
    RETURN -1;
END;
$$;
