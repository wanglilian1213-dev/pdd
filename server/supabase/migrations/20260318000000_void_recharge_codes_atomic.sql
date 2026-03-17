CREATE OR REPLACE FUNCTION void_recharge_codes(
  p_code_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested_count INTEGER := COALESCE(array_length(p_code_ids, 1), 0);
  v_matching_ids UUID[];
  v_matching_count INTEGER := 0;
  v_voided_count INTEGER := 0;
BEGIN
  IF v_requested_count = 0 THEN
    RAISE EXCEPTION 'RECHARGE_CODE_NONE_VOIDABLE';
  END IF;

  SELECT array_agg(id)
    INTO v_matching_ids
    FROM (
      SELECT id
      FROM recharge_codes
      WHERE id = ANY(p_code_ids)
        AND status = 'unused'
      FOR UPDATE
    ) locked_codes;

  v_matching_count := COALESCE(array_length(v_matching_ids, 1), 0);

  IF v_matching_count = 0 THEN
    RAISE EXCEPTION 'RECHARGE_CODE_NONE_VOIDABLE';
  END IF;

  IF v_matching_count <> v_requested_count THEN
    RAISE EXCEPTION 'RECHARGE_CODE_PARTIAL_VOID';
  END IF;

  UPDATE recharge_codes
    SET status = 'voided'
    WHERE id = ANY(p_code_ids)
      AND status = 'unused';

  GET DIAGNOSTICS v_voided_count = ROW_COUNT;

  IF v_voided_count <> v_requested_count THEN
    RAISE EXCEPTION 'RECHARGE_CODE_PARTIAL_VOID';
  END IF;

  RETURN jsonb_build_object('voidedCount', v_voided_count);
END;
$$;
