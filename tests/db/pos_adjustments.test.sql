-- POS edit / item-less / void tests. Runs inside a transaction and ALWAYS rolls back:
-- no live data is changed. Run: bash tests/db/run.sh
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_admin uuid; v_vault uuid; v_p1 uuid; v_p2 uuid; s1 numeric; s2 numeric; v_sale jsonb; v_id uuid;
  v_ok boolean; r public.sales; v_pay numeric; v_cnt int; v_old_hash text;
BEGIN
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role='admin' LIMIT 1;
  SELECT id INTO v_vault FROM public.list_business_cash_vaults() LIMIT 1;
  SELECT id, current_stock INTO v_p1, s1 FROM public.products WHERE current_stock >= 10 ORDER BY name LIMIT 1;
  SELECT id, current_stock INTO v_p2, s2 FROM public.products WHERE current_stock >= 10 AND id<>v_p1 ORDER BY name LIMIT 1;
  IF v_admin IS NULL OR v_vault IS NULL OR v_p2 IS NULL THEN RAISE EXCEPTION 'test prerequisites missing'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  -- 0. No password configured -> rejected (simulate unset)
  SELECT pos_authorization_hash INTO v_old_hash FROM public.app_settings LIMIT 1;
  UPDATE public.app_settings SET pos_authorization_hash=NULL;
  v_sale := public.create_pos_sale(jsonb_build_array(
    jsonb_build_object('product_id',v_p1,'quantity',4,'unit_price',100),
    jsonb_build_object('product_id',v_p2,'quantity',2,'unit_price',50)),'Test',0,'cash',v_vault,NULL);
  v_id := (v_sale->>'id')::uuid;
  BEGIN PERFORM public.pos_item_less(v_id,v_p1,1,'x','12345'); RAISE EXCEPTION 'FAIL: unconfigured password accepted';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%not configured%' THEN RAISE; END IF; END;
  RAISE NOTICE 'PASS no default/hardcoded password';

  PERFORM public.set_pos_authorization_password('TestPw#99');

  -- 1. Wrong password rejected for edit, item less, void
  BEGIN PERFORM public.pos_edit_sale(v_id,'[]'::jsonb,'',0,'r','wrong'); RAISE EXCEPTION 'FAIL edit';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Incorrect authorization%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.pos_item_less(v_id,v_p1,1,'r','wrong'); RAISE EXCEPTION 'FAIL item less';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Incorrect authorization%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.void_pos_sale(v_id,'r','wrong'); RAISE EXCEPTION 'FAIL void';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Incorrect authorization%' THEN RAISE; END IF; END;
  SELECT * INTO r FROM public.sales WHERE id=v_id;
  IF r.grand_total<>500 THEN RAISE EXCEPTION 'FAIL unauthorized call changed invoice'; END IF;
  RAISE NOTICE 'PASS unauthorized edits rejected, invoice unchanged';

  -- 2. Item less partial: 4 -> 3 of p1
  PERFORM public.pos_item_less(v_id,v_p1,1,'customer returned one','TestPw#99');
  SELECT * INTO r FROM public.sales WHERE id=v_id;
  SELECT amount INTO v_pay FROM public.payments WHERE sale_id=v_id;
  IF r.grand_total<>400 OR r.amount_received<>400 OR v_pay<>400 OR r.payment_status<>'paid' THEN RAISE EXCEPTION 'FAIL totals after item less: % % %',r.grand_total,r.amount_received,v_pay; END IF;
  IF (SELECT current_stock FROM public.products WHERE id=v_p1) <> s1-3 THEN RAISE EXCEPTION 'FAIL stock after item less'; END IF;
  RAISE NOTICE 'PASS item less partial: totals, payment, stock';

  -- 3. Over-removal and duplicate guard
  BEGIN PERFORM public.pos_item_less(v_id,v_p1,99,'r','TestPw#99'); RAISE EXCEPTION 'FAIL over-remove';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Cannot remove%' THEN RAISE; END IF; END;
  -- 4. Full line removal restores stock exactly once
  PERFORM public.pos_item_less(v_id,v_p2,2,'not needed','TestPw#99');
  IF (SELECT current_stock FROM public.products WHERE id=v_p2) <> s2 THEN RAISE EXCEPTION 'FAIL double/missing stock restore on full removal: %', (SELECT current_stock FROM public.products WHERE id=v_p2); END IF;
  SELECT * INTO r FROM public.sales WHERE id=v_id;
  IF r.grand_total<>300 THEN RAISE EXCEPTION 'FAIL total after full removal'; END IF;
  BEGIN PERFORM public.pos_item_less(v_id,v_p1,3,'r','TestPw#99'); RAISE EXCEPTION 'FAIL last item removable';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%last item%' THEN RAISE; END IF; END;
  RAISE NOTICE 'PASS full line removal, no double restore, last-item guard';

  -- 5. Authorized edit: change qty/price, add p2, discount; invoice no preserved
  PERFORM public.pos_edit_sale(v_id, jsonb_build_array(
    jsonb_build_object('product_id',v_p1,'quantity',5,'unit_price',110),
    jsonb_build_object('product_id',v_p2,'quantity',1,'unit_price',60)),'Edited Cust',10,'price correction','TestPw#99');
  SELECT * INTO r FROM public.sales WHERE id=v_id;
  SELECT amount INTO v_pay FROM public.payments WHERE sale_id=v_id;
  IF r.invoice_no <> v_sale->>'invoice_no' THEN RAISE EXCEPTION 'FAIL invoice number changed'; END IF;
  IF r.subtotal<>610 OR r.discount<>10 OR r.grand_total<>600 OR v_pay<>600 OR r.customer_name<>'Edited Cust' THEN RAISE EXCEPTION 'FAIL edit totals % % %',r.subtotal,r.grand_total,v_pay; END IF;
  IF (SELECT current_stock FROM public.products WHERE id=v_p1) <> s1-5 OR (SELECT current_stock FROM public.products WHERE id=v_p2) <> s2-1 THEN RAISE EXCEPTION 'FAIL stock after edit'; END IF;
  RAISE NOTICE 'PASS authorized edit: lines, totals, payment, stock, invoice no preserved';

  -- 6. Edit cannot oversell stock
  BEGIN PERFORM public.pos_edit_sale(v_id, jsonb_build_array(jsonb_build_object('product_id',v_p1,'quantity',s1+1000,'unit_price',1)),'',0,'r','TestPw#99'); RAISE EXCEPTION 'FAIL oversell';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Insufficient stock%' THEN RAISE; END IF; END;
  IF (SELECT min(current_stock) FROM public.products WHERE id IN (v_p1,v_p2)) < 0 THEN RAISE EXCEPTION 'FAIL negative stock'; END IF;
  RAISE NOTICE 'PASS no negative stock';

  -- 7. Audit trail
  SELECT count(*) INTO v_cnt FROM public.inventory_adjustments WHERE sale_id=v_id;
  IF v_cnt < 4 THEN RAISE EXCEPTION 'FAIL inventory audit rows: %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM public.activity_logs WHERE entity_id=v_id AND action IN ('pos_item_less','pos_edit');
  IF v_cnt <> 3 THEN RAISE EXCEPTION 'FAIL activity log rows: %', v_cnt; END IF;
  RAISE NOTICE 'PASS audit trail';

  -- 8. Void restores all stock, removes payment, keeps invoice row
  PERFORM public.void_pos_sale(v_id,'test void','TestPw#99');
  SELECT * INTO r FROM public.sales WHERE id=v_id;
  IF NOT r.is_voided OR EXISTS(SELECT 1 FROM public.payments WHERE sale_id=v_id) THEN RAISE EXCEPTION 'FAIL void'; END IF;
  IF (SELECT current_stock FROM public.products WHERE id=v_p1) <> s1 OR (SELECT current_stock FROM public.products WHERE id=v_p2) <> s2 THEN RAISE EXCEPTION 'FAIL stock after void'; END IF;
  BEGIN PERFORM public.void_pos_sale(v_id,'again','TestPw#99'); RAISE EXCEPTION 'FAIL double void';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%already deleted%' THEN RAISE; END IF; END;
  RAISE NOTICE 'PASS void: stock restored once, payment removed, history kept';

  -- 9. Unauthenticated caller rejected
  PERFORM set_config('request.jwt.claims', '{}', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN PERFORM public.pos_item_less(v_id,v_p1,1,'r','TestPw#99'); RAISE EXCEPTION 'FAIL anon';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Not authorized%' THEN RAISE; END IF; END;
  RAISE NOTICE 'PASS unauthenticated rejected';
  RAISE NOTICE 'ALL POS ADJUSTMENT TESTS PASSED';
END $$;
ROLLBACK;
