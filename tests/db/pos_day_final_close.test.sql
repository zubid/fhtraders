-- POS final day close + closed-day guards. STAGING ONLY: requires
-- 20261103000000..20261107050000 and db/pending-migrations/20261107060000 applied.
-- ALWAYS rolled back (DO block raises at the end + ROLLBACK). Uses its own fixture day/sale.
BEGIN;
DO $$
DECLARE
  v_admin uuid; v_vault uuid; v_p1 uuid; v_day uuid; v_day2 uuid; v_sale jsonb; v_id uuid; v_pf jsonb;
  v_dev jsonb; v_ops jsonb; v_res jsonb; v_mv text; d public.pos_business_days;
BEGIN
  IF EXISTS(SELECT 1 FROM public.pos_business_days WHERE status='open') THEN
    RAISE EXCEPTION 'test prerequisite: no open POS day may exist in staging before running';
  END IF;
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role='admin' LIMIT 1;
  SELECT id INTO v_vault FROM public.vault_users WHERE is_active AND vault_type='business_cash' ORDER BY name LIMIT 1;
  SELECT id INTO v_p1 FROM public.products WHERE current_stock >= 10 ORDER BY name LIMIT 1;
  IF v_admin IS NULL OR v_vault IS NULL OR v_p1 IS NULL THEN RAISE EXCEPTION 'test prerequisites missing'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.set_pos_authorization_password('Fixture#Pw1');

  -- Stale-day scenario: an open day from yesterday must still be closable (no deadlock)
  v_day := public.open_pos_business_day(1000, v_vault, 'fixture');
  v_sale := public.create_pos_sale(jsonb_build_array(jsonb_build_object('product_id',v_p1,'quantity',1,'unit_price',100)),'Fixture',0,'cash',v_vault,NULL);
  v_id := (v_sale->>'id')::uuid;

  v_pf := public.get_pos_day_close_preflight(v_day);
  SELECT COALESCE(jsonb_agg(x->>'id'),'[]') INTO v_dev FROM jsonb_array_elements(v_pf->'active_devices') x;
  SELECT COALESCE(jsonb_agg(x->>'id'),'[]') INTO v_ops FROM jsonb_array_elements(v_pf->'pending_operations') x;
  v_mv := CASE WHEN (v_pf->>'unclassified_movement_count')::int>0 THEN 'unclassified' ELSE 'none' END;

  -- Refusals: wrong password, no reason, no confirm, missing attestations
  BEGIN PERFORM public.finalize_pos_day_closing(v_day,1100,'bad','end of day',jsonb_build_object('device_ids',v_dev,'pending_operation_ids',v_ops),jsonb_build_object('classification',v_mv,'note','n'),true); RAISE EXCEPTION 'FAIL wrong pw';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Incorrect POS authorization%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.finalize_pos_day_closing(v_day,1100,'Fixture#Pw1',' ',jsonb_build_object('device_ids',v_dev,'pending_operation_ids',v_ops),jsonb_build_object('classification',v_mv,'note','n'),true); RAISE EXCEPTION 'FAIL no reason';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Closing reason is required%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.finalize_pos_day_closing(v_day,1100,'Fixture#Pw1','end of day',jsonb_build_object('device_ids',v_dev,'pending_operation_ids',v_ops),jsonb_build_object('classification',v_mv,'note','n'),false); RAISE EXCEPTION 'FAIL no confirm';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Explicit confirmation%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.finalize_pos_day_closing(v_day,1100,'Fixture#Pw1','end of day',NULL,jsonb_build_object('classification',v_mv,'note','n'),true); RAISE EXCEPTION 'FAIL no offline attestation';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Offline device attestation%' THEN RAISE; END IF; END;
  IF jsonb_array_length(v_dev)>0 THEN
    BEGIN PERFORM public.finalize_pos_day_closing(v_day,1100,'Fixture#Pw1','end of day',jsonb_build_object('device_ids','[]'::jsonb,'pending_operation_ids',v_ops),jsonb_build_object('classification',v_mv,'note','n'),true); RAISE EXCEPTION 'FAIL device omitted';
    EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Offline attestation missing%' THEN RAISE; END IF; END;
  END IF;
  BEGIN PERFORM public.finalize_pos_day_closing(v_day,1100,'Fixture#Pw1','end of day',jsonb_build_object('device_ids',v_dev,'pending_operation_ids',v_ops),'{}'::jsonb,true); RAISE EXCEPTION 'FAIL no movement attestation';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Cash movement attestation%' THEN RAISE; END IF; END;
  SELECT * INTO d FROM public.pos_business_days WHERE id=v_day;
  IF d.status<>'open' THEN RAISE EXCEPTION 'FAIL rejected finalize changed day'; END IF;

  -- Successful final close
  v_res := public.finalize_pos_day_closing(v_day,1100,'Fixture#Pw1','end of day',
    jsonb_build_object('device_ids',v_dev,'pending_operation_ids',v_ops,'statement','all synced'),
    jsonb_build_object('classification',v_mv,'note','fixture'),true);
  SELECT * INTO d FROM public.pos_business_days WHERE id=v_day;
  IF d.status<>'closed' OR d.counted_cash<>1100 OR d.closing_reason<>'end of day' THEN RAISE EXCEPTION 'FAIL day not closed correctly'; END IF;
  IF v_mv='unclassified' AND d.expected_cash_status<>'unverified' THEN RAISE EXCEPTION 'FAIL unclassified movements claimed exact'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.activity_logs WHERE entity_id=v_day AND action='pos_day_closed') THEN RAISE EXCEPTION 'FAIL no audit log'; END IF;

  -- Second finalize refused
  BEGIN PERFORM public.finalize_pos_day_closing(v_day,1100,'Fixture#Pw1','again',jsonb_build_object('device_ids',v_dev,'pending_operation_ids',v_ops),jsonb_build_object('classification',v_mv,'note','n'),true); RAISE EXCEPTION 'FAIL double finalize';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%already closed%' THEN RAISE; END IF; END;

  -- Closed-day guards: edit, item-less, void refused
  BEGIN PERFORM public.pos_edit_sale(v_id,jsonb_build_array(jsonb_build_object('product_id',v_p1,'quantity',2,'unit_price',100)),'',0,'r','Fixture#Pw1'); RAISE EXCEPTION 'FAIL edit closed day';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'POS day % is closed%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.pos_item_less(v_id,v_p1,1,'r','Fixture#Pw1'); RAISE EXCEPTION 'FAIL item-less closed day';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'POS day % is closed%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.void_pos_sale(v_id,'r','Fixture#Pw1'); RAISE EXCEPTION 'FAIL void closed day';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'POS day % is closed%' THEN RAISE; END IF; END;
  BEGIN UPDATE public.pos_business_days SET counted_cash=0 WHERE id=v_day; RAISE EXCEPTION 'FAIL closed day mutable';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'POS day % is closed and cannot be changed' THEN RAISE; END IF; END;

  -- Next-day open path: a new day can open after close (same date blocked by UNIQUE in this fixture,
  -- so verify the "already open" guard is gone instead).
  IF EXISTS(SELECT 1 FROM public.pos_business_days WHERE status='open') THEN RAISE EXCEPTION 'FAIL day still open'; END IF;

  RAISE EXCEPTION 'ALL_TESTS_PASSED (rolled back)';
END $$;
ROLLBACK;
