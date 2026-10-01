CREATE OR REPLACE FUNCTION public.archive_sale(p_sale_id uuid,p_reason text DEFAULT 'Archived')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.sales; r record; returned numeric; restore_qty numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
 SELECT * INTO s FROM public.sales WHERE id=p_sale_id AND NOT COALESCE(is_voided,false) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found or already archived'; END IF;
 FOR r IN SELECT * FROM public.sale_items WHERE sale_id=s.id LOOP
   SELECT COALESCE(sum(a.quantity),0) INTO returned FROM public.inventory_adjustments a WHERE a.sale_id=s.id AND a.product_id=r.product_id AND a.adjustment_type IN('sale_return','pos_item_less');
   restore_qty:=GREATEST(0,r.quantity-returned);
   IF restore_qty>0 THEN
     UPDATE public.products SET current_stock=current_stock+restore_qty WHERE id=r.product_id;
     INSERT INTO public.stock_movements(product_id,movement_type,quantity,balance_after,reference_type,reference_id)
     SELECT r.product_id,'in',restore_qty,current_stock,'sale_archive',s.id FROM public.products WHERE id=r.product_id;
   END IF;
 END LOOP;
 DELETE FROM public.payments WHERE sale_id=s.id;
 UPDATE public.sales SET is_voided=true,voided_at=now(),voided_by=auth.uid(),void_reason=COALESCE(NULLIF(btrim(p_reason),''),'Archived'),amount_received=0,payment_status='unpaid' WHERE id=s.id;
END $$;
GRANT EXECUTE ON FUNCTION public.archive_sale(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.void_pos_sale(p_sale_id uuid,p_reason text,p_password text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.sales; r record; returned numeric; restore_qty numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF NOT public.verify_pos_authorization(p_password) THEN RAISE EXCEPTION 'Incorrect authorization password'; END IF;
 IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;
 SELECT * INTO s FROM public.sales WHERE id=p_sale_id AND source='pos' AND NOT COALESCE(is_voided,false) FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'POS sale not found'; END IF;
 FOR r IN SELECT * FROM public.sale_items WHERE sale_id=s.id LOOP
   SELECT COALESCE(sum(a.quantity),0) INTO returned FROM public.inventory_adjustments a WHERE a.sale_id=s.id AND a.product_id=r.product_id AND a.adjustment_type IN('sale_return','pos_item_less');
   restore_qty:=GREATEST(0,r.quantity-returned);
   IF restore_qty>0 THEN
     UPDATE public.products SET current_stock=current_stock+restore_qty WHERE id=r.product_id;
     INSERT INTO public.stock_movements(product_id,movement_type,quantity,balance_after,reference_type,reference_id) SELECT r.product_id,'in',restore_qty,current_stock,'pos_void',s.id FROM public.products WHERE id=r.product_id;
     INSERT INTO public.inventory_adjustments(adjustment_type,sale_id,product_id,quantity,amount,reason,created_by) VALUES('pos_void',s.id,r.product_id,restore_qty,restore_qty*r.unit_price,btrim(p_reason),auth.uid());
   END IF;
 END LOOP;
 DELETE FROM public.payments WHERE sale_id=s.id;
 UPDATE public.sales SET is_voided=true,voided_at=now(),voided_by=auth.uid(),void_reason=btrim(p_reason),amount_received=0,payment_status='unpaid' WHERE id=s.id;
END $$;
GRANT EXECUTE ON FUNCTION public.void_pos_sale(uuid,text,text) TO authenticated;