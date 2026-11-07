-- PENDING REVIEW — NOT APPLIED. Apply only after staging verification, after
-- 20261103000000 .. 20261107050000 (in supabase/migrations) are applied.
-- Kept outside supabase/migrations so no tool applies it to production.
--
-- Task 9: authorized, auditable FINAL POS day close + closed-day guards.
-- Additive only: no data rewritten, no rows deleted, no sales reassigned.
--
-- Rules:
--  * Final close needs: POS authorization password, physically counted cash,
--    a reason, explicit confirmation, an attestation for every active offline
--    device and every server-visible pending/rejected sync operation, and an
--    attestation for unclassified vault movements on that day.
--  * Expected cash is labelled 'exact' ONLY when no vault movement,
--    other-vault receipt or pending offline operation exists. Otherwise it is
--    'operator_classified' or 'unverified' — never presented as exact.
--  * Offline sales are never moved between days; they stay queued.
--  * Any open day (including a stale earlier date) can be finalized, which
--    removes the next-day deadlock; open_pos_business_day then works as-is.
--  * Once closed, a day's sales, sale lines, POS payments and the day row
--    itself are immutable (edit / item-less / void are refused).

-- 1. Allow finalized attempts (constraint swap; existing draft rows stay valid)
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.pos_day_closing_attempts'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP EXECUTE format('ALTER TABLE public.pos_day_closing_attempts DROP CONSTRAINT %I', c); END LOOP;
END $$;
ALTER TABLE public.pos_day_closing_attempts
  ADD CONSTRAINT pos_day_closing_attempts_status_chk CHECK (status IN ('draft','finalized'));
ALTER TABLE public.pos_day_closing_attempts
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS expected_cash numeric,
  ADD COLUMN IF NOT EXISTS expected_cash_status text,
  ADD COLUMN IF NOT EXISTS cash_difference numeric,
  ADD COLUMN IF NOT EXISTS offline_attestation jsonb,
  ADD COLUMN IF NOT EXISTS movement_attestation jsonb,
  ADD COLUMN IF NOT EXISTS snapshot jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS pos_one_final_close_per_day
  ON public.pos_day_closing_attempts(pos_business_day_id) WHERE status='finalized';

ALTER TABLE public.pos_business_days
  ADD COLUMN IF NOT EXISTS expected_cash_status text,
  ADD COLUMN IF NOT EXISTS closing_reason text,
  ADD COLUMN IF NOT EXISTS closing_attempt_id uuid REFERENCES public.pos_day_closing_attempts(id);

-- 2. Read-only preflight: what the operator must attest before closing
CREATE OR REPLACE FUNCTION public.get_pos_day_close_preflight(p_day_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.pos_business_days%ROWTYPE; r jsonb; m jsonb; v_devices jsonb; v_pending jsonb; v_unclassified int;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN
   RAISE EXCEPTION 'Not authorized';
 END IF;
 SELECT * INTO d FROM public.pos_business_days WHERE id=p_day_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'POS business day not found'; END IF;
 r := public.get_pos_day_reconciliation(p_day_id);
 m := public.get_pos_day_movements(p_day_id);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'location',location_label,'last_seen_at',last_seen_at) ORDER BY name),'[]')
   INTO v_devices FROM public.sync_devices WHERE is_active;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',o.id,'operation_type',o.operation_type,'status',o.status,
          'error',o.error_message,'created_at',o.created_at,'device_id',o.device_id) ORDER BY o.created_at),'[]')
   INTO v_pending FROM public.sync_operations o WHERE o.status IN ('received','rejected');
 v_unclassified := COALESCE((m->>'expense_count')::int,0)+COALESCE((m->>'topup_count')::int,0)
   +COALESCE((m->>'transfer_in_count')::int,0)+COALESCE((m->>'transfer_out_count')::int,0)
   +COALESCE((m->>'customer_refund_count')::int,0)+COALESCE((m->>'supplier_refund_count')::int,0);
 RETURN jsonb_build_object(
   'day_id',d.id,'business_date',d.business_date,'status',d.status,
   'is_stale',d.business_date < (now() AT TIME ZONE 'Asia/Karachi')::date,
   'reconciliation',r,'movements',m,
   'unclassified_movement_count',v_unclassified,
   'other_vault_payment_count',COALESCE((r->>'other_vault_payment_count')::int,0),
   'active_devices',v_devices,'pending_operations',v_pending,
   'pos_sales_expected_cash',(r->>'provisional_expected_cash')::numeric,
   'expected_cash_if_movements_are_cash',(r->>'provisional_expected_cash')::numeric+COALESCE((m->>'known_vault_net_movement')::numeric,0)
 );
END $$;
REVOKE ALL ON FUNCTION public.get_pos_day_close_preflight(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pos_day_close_preflight(uuid) TO authenticated;

-- 3. Final close
-- p_offline_attestation: {"device_ids":[uuid...], "pending_operation_ids":[uuid...], "statement":"..."}
--   must list EVERY active device and EVERY received/rejected sync operation.
-- p_movement_attestation: {"classification":"none"|"all_cash"|"unclassified", "note":"..."}
--   'none' only allowed when there are no movements; others need a note.
CREATE OR REPLACE FUNCTION public.finalize_pos_day_closing(
  p_day_id uuid, p_counted_cash numeric, p_password text, p_reason text,
  p_offline_attestation jsonb, p_movement_attestation jsonb, p_confirm boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  d public.pos_business_days%ROWTYPE; pf jsonb; v_cls text; v_note text;
  v_expected numeric; v_status text; v_attempt uuid; v_diff numeric; v_missing int;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_password IS NULL OR NOT public.verify_pos_authorization(p_password) THEN
    RAISE EXCEPTION 'Incorrect POS authorization password';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'Closing reason is required'; END IF;
  IF p_counted_cash IS NULL OR p_counted_cash < 0 THEN RAISE EXCEPTION 'Counted cash must be zero or greater'; END IF;
  IF p_confirm IS DISTINCT FROM true THEN RAISE EXCEPTION 'Explicit confirmation is required to finalize'; END IF;

  SELECT * INTO d FROM public.pos_business_days WHERE id=p_day_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POS business day not found'; END IF;
  IF d.status<>'open' THEN RAISE EXCEPTION 'POS day % is already closed', d.business_date; END IF;

  pf := public.get_pos_day_close_preflight(p_day_id);

  IF p_offline_attestation IS NULL OR jsonb_typeof(p_offline_attestation->'device_ids') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_offline_attestation->'pending_operation_ids') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Offline device attestation is required';
  END IF;
  SELECT count(*) INTO v_missing FROM jsonb_array_elements(pf->'active_devices') x
   WHERE NOT (p_offline_attestation->'device_ids') ? (x->>'id');
  IF v_missing>0 THEN RAISE EXCEPTION 'Offline attestation missing % active device(s)', v_missing; END IF;
  SELECT count(*) INTO v_missing FROM jsonb_array_elements(pf->'pending_operations') x
   WHERE NOT (p_offline_attestation->'pending_operation_ids') ? (x->>'id');
  IF v_missing>0 THEN RAISE EXCEPTION 'Offline attestation missing % pending sync operation(s)', v_missing; END IF;

  v_cls := p_movement_attestation->>'classification';
  v_note := NULLIF(btrim(COALESCE(p_movement_attestation->>'note','')),'');
  IF v_cls IS NULL OR v_cls NOT IN ('none','all_cash','unclassified') THEN
    RAISE EXCEPTION 'Cash movement attestation is required';
  END IF;
  IF (pf->>'unclassified_movement_count')::int > 0 AND v_cls='none' THEN
    RAISE EXCEPTION 'This day has % vault movement(s); classify them as all cash or unclassified', (pf->>'unclassified_movement_count');
  END IF;
  IF v_cls<>'none' AND v_note IS NULL THEN RAISE EXCEPTION 'A note explaining the cash movements is required'; END IF;

  v_expected := CASE WHEN v_cls='all_cash' THEN (pf->>'expected_cash_if_movements_are_cash')::numeric
                     ELSE (pf->>'pos_sales_expected_cash')::numeric END;
  v_status := CASE
    WHEN v_cls='unclassified' THEN 'unverified'
    WHEN (pf->>'other_vault_payment_count')::int > 0 OR jsonb_array_length(pf->'pending_operations') > 0 THEN 'unverified'
    WHEN v_cls='all_cash' THEN 'operator_classified'
    ELSE 'exact' END;
  v_diff := p_counted_cash - v_expected;

  INSERT INTO public.pos_day_closing_attempts(pos_business_day_id,counted_cash,closing_note,attempted_by,status,
    reason,expected_cash,expected_cash_status,cash_difference,offline_attestation,movement_attestation,snapshot)
  VALUES(p_day_id,p_counted_cash,v_note,auth.uid(),'finalized',btrim(p_reason),v_expected,v_status,v_diff,
    p_offline_attestation,p_movement_attestation,pf)
  RETURNING id INTO v_attempt;

  UPDATE public.pos_business_days SET status='closed', counted_cash=p_counted_cash, expected_cash=v_expected,
    cash_difference=v_diff, expected_cash_status=v_status, closing_reason=btrim(p_reason),
    closing_note=v_note, closing_snapshot=pf, closing_attempt_id=v_attempt,
    closed_by=auth.uid(), closed_at=now()
  WHERE id=p_day_id;

  INSERT INTO public.activity_logs(user_id,action,entity_type,entity_id,reference,summary,new_data,metadata)
  VALUES(auth.uid(),'pos_day_closed','pos_business_day',p_day_id,d.business_date::text,
    format('POS day %s closed. Counted %s, expected %s (%s)', d.business_date, p_counted_cash, v_expected, v_status),
    jsonb_build_object('attempt_id',v_attempt,'counted_cash',p_counted_cash,'expected_cash',v_expected,
      'expected_cash_status',v_status,'difference',v_diff),
    jsonb_build_object('reason',btrim(p_reason),'offline_attestation',p_offline_attestation,'movement_attestation',p_movement_attestation));

  RETURN jsonb_build_object('attempt_id',v_attempt,'day_id',p_day_id,'business_date',d.business_date,
    'status','closed','counted_cash',p_counted_cash,'expected_cash',v_expected,
    'expected_cash_status',v_status,'difference',v_diff,'next_step','Open the next POS day to resume sales');
END $$;
REVOKE ALL ON FUNCTION public.finalize_pos_day_closing(uuid,numeric,text,text,jsonb,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalize_pos_day_closing(uuid,numeric,text,text,jsonb,jsonb,boolean) TO authenticated;

-- 4. Closed-day immutability guards. They cover pos_edit_sale, pos_item_less,
--    void_pos_sale and any direct write, since all of them touch these tables.
CREATE OR REPLACE FUNCTION public.guard_closed_pos_day_sale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_day uuid; v_date date;
BEGIN
  IF TG_TABLE_NAME='sales' THEN
    v_day := OLD.pos_business_day_id;
  ELSE
    SELECT s.pos_business_day_id INTO v_day FROM public.sales s
     WHERE s.id = CASE WHEN TG_OP='INSERT' THEN NEW.sale_id ELSE OLD.sale_id END;
  END IF;
  IF v_day IS NOT NULL THEN
    SELECT business_date INTO v_date FROM public.pos_business_days WHERE id=v_day AND status='closed';
    IF FOUND THEN
      RAISE EXCEPTION 'POS day % is closed; its sales cannot be edited, reduced or voided. Record a correction on the current day.', v_date;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.guard_closed_pos_day_sale() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS trg_guard_closed_day_sales ON public.sales;
CREATE TRIGGER trg_guard_closed_day_sales BEFORE UPDATE OR DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_pos_day_sale();
DROP TRIGGER IF EXISTS trg_guard_closed_day_sale_items ON public.sale_items;
CREATE TRIGGER trg_guard_closed_day_sale_items BEFORE INSERT OR UPDATE OR DELETE ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_pos_day_sale();
DROP TRIGGER IF EXISTS trg_guard_closed_day_payments ON public.payments;
CREATE TRIGGER trg_guard_closed_day_payments BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW WHEN (OLD.sale_id IS NOT NULL) EXECUTE FUNCTION public.guard_closed_pos_day_sale();

CREATE OR REPLACE FUNCTION public.guard_closed_pos_day_row() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'POS business days cannot be deleted'; END IF;
  IF OLD.status='closed' THEN RAISE EXCEPTION 'POS day % is closed and cannot be changed', OLD.business_date; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_closed_day_row ON public.pos_business_days;
CREATE TRIGGER trg_guard_closed_day_row BEFORE UPDATE OR DELETE ON public.pos_business_days
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_pos_day_row();

CREATE OR REPLACE FUNCTION public.guard_closing_attempt_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Closing records are append-only'; END $$;
DROP TRIGGER IF EXISTS trg_guard_closing_attempts ON public.pos_day_closing_attempts;
CREATE TRIGGER trg_guard_closing_attempts BEFORE UPDATE OR DELETE ON public.pos_day_closing_attempts
  FOR EACH ROW EXECUTE FUNCTION public.guard_closing_attempt_append_only();
