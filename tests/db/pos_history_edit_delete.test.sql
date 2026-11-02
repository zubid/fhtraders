-- POS History: Edit Invoice + Delete Sale. ALWAYS rolled back (ends with ROLLBACK, and the
-- DO block also raises at the end so it rolls back even when run as a single statement).
-- Creates its own fixture sale; never touches real sales/payments/stock.
BEGIN;
DO $$
DECLARE
  v_admin uuid; v_vault uuid; v_p1 uuid; v_p2 uuid; s1 numeric; s2 numeric; v_sale jsonb; v_id uuid;
  r public.sales; v_pay numeric; v_vb0 numeric; v_vb numeric; v_cnt int; v_nobody uuid := gen_random_uuid();
BEGIN
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role='admin' LIMIT 1;
  SELECT id INTO v_vault FROM public.vault_users WHERE is_active AND vault_type='business_cash' ORDER BY name LIMIT 1;
  SELECT id, current_stock INTO v_p1, s1 FROM public.products WHERE current_stock >= 10 ORDER BY name LIMIT 1;
  SELECT id, current_stock INTO v_p2, s2 FROM public.products WHERE current_stock >= 10 AND id<>v_p1 ORDER BY name LIMIT 1;
  IF v_admin IS NULL OR v_vault IS NULL OR v_p2 IS NULL THEN RAISE EXCEPTION 'test prerequisites missing'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.set_pos_authorization_password('Fixture#Pw1');   -- rolled back
  v_vb0 := public.vault_available_balance(v_vault);

  v_sale := public.create_pos_sale(jsonb_build_array(
    jsonb_build_object('product_id',v_p1,'quantity',4,'unit_price',100),
    jsonb_build_object('product_id',v_p2,'quantity',2,'unit_price',50)),'Fixture',0,'cash',v_vault,NULL);
  v_id := (v_sale->>'id')::uuid;
  IF public.vault_available_balance(v_vault) <> v_vb0+500 THEN RAISE EXCEPTION 'FAIL vault after sale'; END IF;

  -- wrong password / missing reason
  BEGIN PERFORM public.pos_edit_sale(v_id,jsonb_build_array(jsonb_build_object('product_id',v_p1,'quantity',1,'unit_price',1)),'',0,'r','bad'); RAISE EXCEPTION 'FAIL edit wrong pw';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Incorrect authorization%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.void_pos_sale(v_id,'r','bad'); RAISE EXCEPTION 'FAIL void wrong pw';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Incorrect authorization%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.pos_edit_sale(v_id,jsonb_build_array(jsonb_build_object('product_id',v_p1,'quantity',1,'unit_price',1)),'',0,'  ','Fixture#Pw1'); RAISE EXCEPTION 'FAIL edit no reason';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Reason is required%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.void_pos_sale(v_id,'','Fixture#Pw1'); RAISE EXCEPTION 'FAIL void no reason';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Reason is required%' THEN RAISE; END IF; END;
  SELECT * INTO r FROM public.sales WHERE id=v_id;
  IF r.grand_total<>500 OR r.is_voided THEN RAISE EXCEPTION 'FAIL rejected call changed invoice'; END IF;

  -- insufficient stock
  BEGIN PERFORM public.pos_edit_sale(v_id,jsonb_build_array(jsonb_build_object('product_id',v_p1,'quantity',s1+1,'unit_price',1)),'',0,'r','Fixture#Pw1'); RAISE EXCEPTION 'FAIL oversell';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Insufficient stock%' THEN RAISE; END IF; END;
  IF (SELECT current_stock FROM public.products WHERE id=v_p1) <> s1-4 THEN RAISE EXCEPTION 'FAIL stock moved on rejected edit'; END IF;

  -- authorized edit: p1 4->6 @90, p2 removed, discount 40 => subtotal 540, total 500... use 20 => 520
  PERFORM public.pos_edit_sale(v_id, jsonb_build_array(jsonb_build_object('product_id',v_p1,'quantity',6,'unit_price',90)),'Edited',20,'price fix','Fixture#Pw1');
  SELECT * INTO r FROM public.sales WHERE id=v_id;
  SELECT amount INTO v_pay FROM public.payments WHERE sale_id=v_id;
  IF r.invoice_no<>v_sale->>'invoice_no' OR r.subtotal<>540 OR r.discount<>20 OR r.grand_total<>520 OR v_pay<>520 OR r.amount_received<>520 OR r.payment_status<>'paid' THEN
    RAISE EXCEPTION 'FAIL edit totals sub % disc % grand % pay %', r.subtotal, r.discount, r.grand_total, v_pay; END IF;
  IF r.total_cost <> (SELECT sum(quantity*cost_price) FROM public.sale_items WHERE sale_id=v_id) THEN RAISE EXCEPTION 'FAIL COGS'; END IF;
  IF (SELECT current_stock FROM public.products WHERE id=v_p1) <> s1-6 OR (SELECT current_stock FROM public.products WHERE id=v_p2) <> s2 THEN RAISE EXCEPTION 'FAIL stock after edit'; END IF;
  IF public.vault_available_balance(v_vault) <> v_vb0+520 THEN RAISE EXCEPTION 'FAIL vault after edit'; END IF;
  SELECT count(*) INTO v_cnt FROM public.inventory_adjustments WHERE sale_id=v_id AND adjustment_type='pos_edit';
  IF v_cnt<>2 THEN RAISE EXCEPTION 'FAIL edit adjustments: %', v_cnt; END IF;

  -- no-role user and anonymous rejected
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_nobody,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_nobody::text, true);
  BEGIN PERFORM public.void_pos_sale(v_id,'r','Fixture#Pw1'); RAISE EXCEPTION 'FAIL no-role void';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Not authorized%' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims', '{}', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN PERFORM public.pos_edit_sale(v_id,'[]'::jsonb,'',0,'r','Fixture#Pw1'); RAISE EXCEPTION 'FAIL anon edit';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Not authorized%' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  -- authorized delete = soft void
  PERFORM public.void_pos_sale(v_id,'customer cancelled','Fixture#Pw1');
  SELECT * INTO r FROM public.sales WHERE id=v_id;
  IF NOT FOUND OR NOT r.is_voided OR r.void_reason<>'customer cancelled' OR r.amount_received<>0 THEN RAISE EXCEPTION 'FAIL soft void'; END IF;
  IF EXISTS(SELECT 1 FROM public.payments WHERE sale_id=v_id) THEN RAISE EXCEPTION 'FAIL payment kept'; END IF;
  IF (SELECT current_stock FROM public.products WHERE id=v_p1) <> s1 OR (SELECT current_stock FROM public.products WHERE id=v_p2) <> s2 THEN RAISE EXCEPTION 'FAIL stock after void'; END IF;
  IF public.vault_available_balance(v_vault) <> v_vb0 THEN RAISE EXCEPTION 'FAIL vault after void'; END IF;
  BEGIN PERFORM public.void_pos_sale(v_id,'again','Fixture#Pw1'); RAISE EXCEPTION 'FAIL double void';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%already deleted%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.pos_edit_sale(v_id,jsonb_build_array(jsonb_build_object('product_id',v_p1,'quantity',1,'unit_price',1)),'',0,'r','Fixture#Pw1'); RAISE EXCEPTION 'FAIL edit voided';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%already deleted%' THEN RAISE; END IF; END;
  SELECT count(*) INTO v_cnt FROM public.activity_logs WHERE entity_id=v_id AND action IN ('pos_edit','pos_void');
  IF v_cnt<>2 THEN RAISE EXCEPTION 'FAIL audit log rows: %', v_cnt; END IF;

  RAISE EXCEPTION 'ALL POS HISTORY EDIT/DELETE TESTS PASSED (rolled back)';
END $$;
ROLLBACK;
