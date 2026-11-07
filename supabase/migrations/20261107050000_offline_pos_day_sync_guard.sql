-- Task 8: protect offline POS day attribution at cloud sync boundary.
-- Require original local creation timestamp; never silently post yesterday's
-- queued sale into today's business day. Legacy 9-arg sync is revoked.
-- Existing already-applied operations remain idempotent.
CREATE OR REPLACE FUNCTION public.sync_pos_sale(
 p_operation_id uuid, p_device_id uuid, p_local_sale_id uuid,
 p_items jsonb, p_customer_name text, p_discount numeric,
 p_method text, p_vault_user_id uuid, p_note text,
 p_occurred_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_day public.pos_business_days%ROWTYPE;
 v_previous public.sync_operations%ROWTYPE;
 v_result jsonb;
 v_local_date date;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN
  RAISE EXCEPTION 'Not authorized';
 END IF;
 -- Return prior successful result without creating another sale.
 SELECT * INTO v_previous FROM public.sync_operations WHERE operation_id=p_operation_id;
 IF FOUND AND v_previous.status='applied' AND v_previous.entity_id IS NOT NULL THEN
  SELECT jsonb_build_object('id',id,'invoice_no',invoice_no,'duplicate',true)
  INTO v_result FROM public.sales WHERE id=v_previous.entity_id;
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
 END IF;
 IF p_occurred_at IS NULL THEN RAISE EXCEPTION 'Original offline sale timestamp is required'; END IF;
 IF p_occurred_at > now() + interval '5 minutes' THEN
  RAISE EXCEPTION 'Offline sale timestamp is in the future; check desktop clock';
 END IF;
 v_local_date := (p_occurred_at AT TIME ZONE 'Asia/Karachi')::date;
 SELECT * INTO v_day FROM public.pos_business_days WHERE status='open' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No open POS day. Offline sale is retained for reconciliation'; END IF;
 IF v_day.business_date <> v_local_date THEN
  RAISE EXCEPTION 'Offline sale belongs to %, but open POS day is %. Manual reconciliation required; sale remains queued',v_local_date,v_day.business_date;
 END IF;
 IF v_day.business_date <> (now() AT TIME ZONE 'Asia/Karachi')::date THEN
  RAISE EXCEPTION 'Open POS day is not today; sync is blocked';
 END IF;
 IF p_vault_user_id IS DISTINCT FROM v_day.vault_user_id THEN
  RAISE EXCEPTION 'Offline sale vault does not match open POS day; reconcile manually';
 END IF;
 -- Original receiver performs atomic, idempotent sync and stock/payment writes.
 RETURN public.sync_pos_sale(p_operation_id,p_device_id,p_local_sale_id,p_items,p_customer_name,p_discount,p_method,p_vault_user_id,p_note);
END $$;
REVOKE ALL ON FUNCTION public.sync_pos_sale(uuid,uuid,uuid,jsonb,text,numeric,text,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_pos_sale(uuid,uuid,uuid,jsonb,text,numeric,text,uuid,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_pos_sale(uuid,uuid,uuid,jsonb,text,numeric,text,uuid,text,timestamptz) TO authenticated;
