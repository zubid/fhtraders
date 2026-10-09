CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS pos_authorization_hash text;
ALTER TABLE public.inventory_adjustments DROP CONSTRAINT IF EXISTS inventory_adjustments_adjustment_type_check;
ALTER TABLE public.inventory_adjustments ADD CONSTRAINT inventory_adjustments_adjustment_type_check
  CHECK (adjustment_type IN ('pos_item_less','pos_void','pos_edit','sale_return','supplier_return'));

CREATE OR REPLACE FUNCTION public.verify_pos_authorization(p_password text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public, extensions AS $$
DECLARE h text;
BEGIN
  SELECT pos_authorization_hash INTO h FROM public.app_settings WHERE pos_authorization_hash IS NOT NULL LIMIT 1;
  IF h IS NULL THEN RAISE EXCEPTION 'POS authorization password is not configured. An admin must set it in Settings.'; END IF;
  RETURN COALESCE(p_password,'') <> '' AND h = extensions.crypt(p_password, h);
END $$;
REVOKE ALL ON FUNCTION public.verify_pos_authorization(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_pos_authorization_password(p_password text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, extensions AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF length(COALESCE(p_password,''))<4 THEN RAISE EXCEPTION 'Password must be at least 4 characters'; END IF;
  UPDATE public.app_settings SET pos_authorization_hash=extensions.crypt(p_password,extensions.gen_salt('bf')), updated_at=now();
  INSERT INTO public.activity_logs(user_id,action,entity_type,summary,metadata)
  VALUES(auth.uid(),'update','app_settings','POS authorization password changed','{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.set_pos_authorization_password(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_pos_authorization_password(text) TO authenticated;

CREATE OR REPLACE FUNCTION public._pos_guard(p_password text, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT public.verify_pos_authorization(p_password) THEN RAISE EXCEPTION 'Incorrect authorization password'; END IF;
  IF NULLIF(btrim(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._pos_guard(text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._pos_recalc(p_sale_id uuid, p_discount numeric) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sub numeric; v_cost numeric; v_disc numeric; v_grand numeric; v_pay uuid;
BEGIN
  SELECT COALESCE(sum(line_total),0), COALESCE(sum(quantity*cost_price),0) INTO v_sub, v_cost FROM public.sale_items WHERE sale_id=p_sale_id;
  v_disc := LEAST(GREATEST(COALESCE(p_discount,0),0), v_sub);
  v_grand := v_sub - v_disc;
  SELECT id INTO v_pay FROM public.payments WHERE sale_id=p_sale_id ORDER BY created_at LIMIT 1;
  IF v_pay IS NOT NULL THEN
    DELETE FROM public.payments WHERE sale_id=p_sale_id AND id<>v_pay;
    IF v_grand > 0 THEN UPDATE public.payments SET amount=v_grand, updated_at=now() WHERE id=v_pay;
    ELSE DELETE FROM public.payments WHERE id=v_pay; END IF;
  END IF;
  UPDATE public.sales SET subtotal=v_sub, discount=v_disc, grand_total=v_grand, total_cost=v_cost,
    amount_received = CASE WHEN v_pay IS NOT NULL THEN v_grand ELSE LEAST(amount_received, v_grand) END
  WHERE id=p_sale_id;
  RETURN v_grand;
END $$;
REVOKE ALL ON FUNCTION public._pos_recalc(uuid,numeric) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.pos_item_less(uuid,uuid,numeric,text,text);
CREATE OR REPLACE FUNCTION public.pos_item_less(p_sale_id uuid,p_product_id uuid,p_quantity numeric,p_reason text,p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.sales; i public.sale_items; v_bal numeric; v_grand numeric; v_lines int;
BEGIN
  PERFORM public._pos_guard(p_password, p_reason);
  IF p_quantity IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  SELECT * INTO s FROM public.sales WHERE id=p_sale_id AND source='pos' AND NOT is_voided FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POS sale not found or already deleted'; END IF;
  SELECT * INTO i FROM public.sale_items WHERE sale_id=s.id AND product_id=p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item is not on this invoice'; END IF;
  IF p_quantity > i.quantity THEN RAISE EXCEPTION 'Cannot remove % — only % on invoice', p_quantity, i.quantity; END IF;
  SELECT count(*) INTO v_lines FROM public.sale_items WHERE sale_id=s.id;
  IF p_quantity = i.quantity AND v_lines = 1 THEN RAISE EXCEPTION 'This is the last item. Use Delete POS Sale instead.'; END IF;
  IF p_quantity = i.quantity THEN
    DELETE FROM public.sale_items WHERE id=i.id;
  ELSE
    UPDATE public.products SET current_stock=current_stock+p_quantity WHERE id=i.product_id RETURNING current_stock INTO v_bal;
    INSERT INTO public.stock_movements(product_id,movement_type,quantity,balance_after,reference_type,reference_id)
    VALUES(i.product_id,'in',p_quantity,v_bal,'pos_item_less',s.id);
    UPDATE public.sale_items SET quantity=quantity-p_quantity, line_total=(quantity-p_quantity)*unit_price WHERE id=i.id;
  END IF;
  v_grand := public._pos_recalc(s.id, s.discount);
  INSERT INTO public.inventory_adjustments(adjustment_type,sale_id,product_id,quantity,amount,reason,created_by)
  VALUES('pos_item_less',s.id,i.product_id,p_quantity,p_quantity*i.unit_price,btrim(p_reason),auth.uid());
  INSERT INTO public.activity_logs(user_id,action,entity_type,entity_id,reference,summary,old_data,new_data,metadata)
  VALUES(auth.uid(),'pos_item_less','sale',s.id,s.invoice_no,'POS item less on '||s.invoice_no,
    jsonb_build_object('grand_total',s.grand_total,'quantity',i.quantity),
    jsonb_build_object('grand_total',v_grand,'quantity',i.quantity-p_quantity),
    jsonb_build_object('product_id',i.product_id,'removed',p_quantity,'reason',btrim(p_reason)));
  RETURN jsonb_build_object('id',s.id,'invoice_no',s.invoice_no,'grand_total',v_grand);
END $$;

CREATE OR REPLACE FUNCTION public.pos_edit_sale(p_sale_id uuid,p_items jsonb,p_customer_name text,p_discount numeric,p_reason text,p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.sales; v_old jsonb; e jsonb; v_pid uuid; v_qty numeric; v_price numeric; v_stock numeric; v_name text;
  v_oldqty numeric; v_sub numeric:=0; v_grand numeric; r record;
BEGIN
  PERFORM public._pos_guard(p_password, p_reason);
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Invoice must have at least one item'; END IF;
  IF COALESCE(p_discount,0) < 0 THEN RAISE EXCEPTION 'Discount cannot be negative'; END IF;
  SELECT * INTO s FROM public.sales WHERE id=p_sale_id AND source='pos' AND NOT is_voided FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POS sale not found or already deleted'; END IF;
  IF (SELECT count(DISTINCT x->>'product_id') FROM jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Duplicate product lines'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id',product_id,'quantity',quantity,'unit_price',unit_price,'cost_price',cost_price)),'[]') INTO v_old FROM public.sale_items WHERE sale_id=s.id;
  FOR e IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid:=(e->>'product_id')::uuid; v_qty:=(e->>'quantity')::numeric; v_price:=(e->>'unit_price')::numeric;
    IF v_qty IS NULL OR v_qty<=0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
    IF v_price IS NULL OR v_price<0 THEN RAISE EXCEPTION 'Invalid price'; END IF;
    SELECT current_stock,name INTO v_stock,v_name FROM public.products WHERE id=v_pid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    SELECT COALESCE(sum(quantity),0) INTO v_oldqty FROM public.sale_items WHERE sale_id=s.id AND product_id=v_pid;
    IF v_qty > v_stock + v_oldqty THEN RAISE EXCEPTION 'Insufficient stock for %: available %', v_name, v_stock + v_oldqty; END IF;
    v_sub := v_sub + v_qty*v_price;
  END LOOP;
  IF COALESCE(p_discount,0) > v_sub THEN RAISE EXCEPTION 'Discount exceeds subtotal'; END IF;
  DELETE FROM public.sale_items WHERE sale_id=s.id;
  INSERT INTO public.sale_items(sale_id,product_id,quantity,unit_price,cost_price,line_total)
  SELECT s.id,(x->>'product_id')::uuid,(x->>'quantity')::numeric,(x->>'unit_price')::numeric,
    COALESCE((SELECT (o->>'cost_price')::numeric FROM jsonb_array_elements(v_old) o WHERE o->>'product_id'=x->>'product_id'),0),
    (x->>'quantity')::numeric*(x->>'unit_price')::numeric
  FROM jsonb_array_elements(p_items) x;
  UPDATE public.sales SET customer_name=NULLIF(btrim(COALESCE(p_customer_name,'')),'') WHERE id=s.id;
  v_grand := public._pos_recalc(s.id, p_discount);
  FOR r IN
    SELECT COALESCE(n.pid,o.pid) pid, COALESCE(o.q,0) oq, COALESCE(n.q,0) nq, COALESCE(n.p,o.p) price FROM
     (SELECT (x->>'product_id')::uuid pid,(x->>'quantity')::numeric q,(x->>'unit_price')::numeric p FROM jsonb_array_elements(p_items) x) n
     FULL JOIN (SELECT (x->>'product_id')::uuid pid,(x->>'quantity')::numeric q,(x->>'unit_price')::numeric p FROM jsonb_array_elements(v_old) x) o ON o.pid=n.pid
  LOOP
    IF r.oq<>r.nq THEN
      INSERT INTO public.inventory_adjustments(adjustment_type,sale_id,product_id,quantity,amount,reason,created_by)
      VALUES('pos_edit',s.id,r.pid,abs(r.nq-r.oq),abs(r.nq-r.oq)*r.price,btrim(p_reason)||CASE WHEN r.nq>r.oq THEN ' (added)' ELSE ' (removed)' END,auth.uid());
    END IF;
  END LOOP;
  INSERT INTO public.activity_logs(user_id,action,entity_type,entity_id,reference,summary,old_data,new_data,metadata)
  VALUES(auth.uid(),'pos_edit','sale',s.id,s.invoice_no,'POS invoice edited '||s.invoice_no,
    jsonb_build_object('items',v_old,'discount',s.discount,'grand_total',s.grand_total,'customer_name',s.customer_name),
    jsonb_build_object('items',p_items,'discount',p_discount,'grand_total',v_grand,'customer_name',p_customer_name),
    jsonb_build_object('reason',btrim(p_reason)));
  RETURN jsonb_build_object('id',s.id,'invoice_no',s.invoice_no,'grand_total',v_grand);
END $$;

DROP FUNCTION IF EXISTS public.void_pos_sale(uuid,text,text);
CREATE OR REPLACE FUNCTION public.void_pos_sale(p_sale_id uuid,p_reason text,p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.sales; r record; v_bal numeric;
BEGIN
  PERFORM public._pos_guard(p_password, p_reason);
  SELECT * INTO s FROM public.sales WHERE id=p_sale_id AND source='pos' AND NOT is_voided FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'POS sale not found or already deleted'; END IF;
  FOR r IN SELECT * FROM public.sale_items WHERE sale_id=s.id LOOP
    UPDATE public.products SET current_stock=current_stock+r.quantity WHERE id=r.product_id RETURNING current_stock INTO v_bal;
    INSERT INTO public.stock_movements(product_id,movement_type,quantity,balance_after,reference_type,reference_id) VALUES(r.product_id,'in',r.quantity,v_bal,'pos_void',s.id);
    INSERT INTO public.inventory_adjustments(adjustment_type,sale_id,product_id,quantity,amount,reason,created_by) VALUES('pos_void',s.id,r.product_id,r.quantity,r.line_total,btrim(p_reason),auth.uid());
  END LOOP;
  DELETE FROM public.payments WHERE sale_id=s.id;
  UPDATE public.sales SET is_voided=true, voided_at=now(), voided_by=auth.uid(), void_reason=btrim(p_reason), amount_received=0 WHERE id=s.id;
  INSERT INTO public.activity_logs(user_id,action,entity_type,entity_id,reference,summary,old_data,metadata)
  VALUES(auth.uid(),'pos_void','sale',s.id,s.invoice_no,'POS sale deleted '||s.invoice_no,jsonb_build_object('grand_total',s.grand_total),jsonb_build_object('reason',btrim(p_reason)));
  RETURN jsonb_build_object('id',s.id,'invoice_no',s.invoice_no);
END $$;

REVOKE ALL ON FUNCTION public.pos_item_less(uuid,uuid,numeric,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pos_edit_sale(uuid,jsonb,text,numeric,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_pos_sale(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_item_less(uuid,uuid,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pos_edit_sale(uuid,jsonb,text,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_pos_sale(uuid,text,text) TO authenticated;