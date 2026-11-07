-- Task 2: enforce a single open POS business day at the database boundary.
-- Online POS and offline sync both call create_pos_sale; keep its original
-- transactional stock, payment, and pricing logic intact in a private core.
-- IMPORTANT: Desktop offline transactions can still be queued locally;
-- they cannot sync until an eligible business day is open. Task 8 addresses
-- explicit offline day assignment and closing safeguards.
DO $$
BEGIN
  IF to_regprocedure('public.create_pos_sale_core(jsonb,text,numeric,text,uuid,text)') IS NULL THEN
    IF to_regprocedure('public.create_pos_sale(jsonb,text,numeric,text,uuid,text)') IS NULL THEN
      RAISE EXCEPTION 'Original create_pos_sale RPC missing; cannot install Task 2 safely';
    END IF;
    ALTER FUNCTION public.create_pos_sale(jsonb,text,numeric,text,uuid,text)
      RENAME TO create_pos_sale_core;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.create_pos_sale_core(jsonb,text,numeric,text,uuid,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_items jsonb, p_customer_name text, p_discount numeric,
  p_method text, p_vault_user_id uuid, p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day public.pos_business_days%ROWTYPE;
  v_result jsonb;
  v_sale_id uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  -- FOR UPDATE serializes sale creation against future day closing.
  SELECT * INTO v_day FROM public.pos_business_days
    WHERE status = 'open' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POS is closed. Open today''s business day before making a sale';
  END IF;
  IF v_day.business_date <> v_today THEN
    RAISE EXCEPTION 'The open POS day is from %, not today (%). Close it before proceeding', v_day.business_date, v_today;
  END IF;
  IF p_vault_user_id IS DISTINCT FROM v_day.vault_user_id THEN
    RAISE EXCEPTION 'Sale vault must match the open POS day business cash vault';
  END IF;
  v_result := public.create_pos_sale_core(p_items,p_customer_name,p_discount,p_method,p_vault_user_id,p_note);
  v_sale_id := (v_result->>'id')::uuid;
  IF v_sale_id IS NULL THEN RAISE EXCEPTION 'POS sale did not return an ID'; END IF;
  UPDATE public.sales SET pos_business_day_id = v_day.id WHERE id = v_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Created POS sale could not be linked to its business day'; END IF;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.create_pos_sale(jsonb,text,numeric,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_pos_sale(jsonb,text,numeric,text,uuid,text) TO authenticated;

-- Existing historical sales are intentionally not assigned to a new day.
-- The transaction rolls back entirely on any guard or core sale failure.
