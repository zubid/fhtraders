CREATE OR REPLACE FUNCTION public.pos_item_less(p_sale_id uuid,p_product_id uuid,p_quantity numeric,p_reason text,p_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.sales; i public.sale_items; amt numeric; newtotal numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF NOT public.verify_pos_authorization(p_password) THEN RAISE EXCEPTION 'Incorrect authorization password'; END IF;
 IF NULLIF(btrim(p_reason),'') IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'Reason and quantity are required'; END IF;
 SELECT * INTO s FROM public.sales WHERE id=p_sale_id AND source='pos' AND NOT is_voided FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'POS sale not found'; END IF;
 SELECT * INTO i FROM public.sale_items WHERE sale_id=s.id AND product_id=p_product_id FOR UPDATE; IF NOT FOUND OR p_quantity>i.quantity THEN RAISE EXCEPTION 'Invalid item quantity'; END IF;
 amt:=p_quantity*i.unit_price;
 UPDATE public.products SET current_stock=current_stock+p_quantity WHERE id=i.product_id;
 INSERT INTO public.stock_movements(product_id,movement_type,quantity,balance_after,reference_type,reference_id)
 SELECT i.product_id,'in',p_quantity,current_stock,'pos_item_less',s.id FROM public.products WHERE id=i.product_id;
 UPDATE public.sale_items SET quantity=quantity-p_quantity,line_total=(quantity-p_quantity)*unit_price WHERE id=i.id;
 newtotal:=GREATEST(0,s.grand_total-amt);
 UPDATE public.sales SET subtotal=GREATEST(0,subtotal-amt),grand_total=newtotal,total_cost=GREATEST(0,total_cost-p_quantity*i.cost_price),amount_received=LEAST(amount_received,newtotal) WHERE id=s.id;
 UPDATE public.payments SET amount=LEAST(amount,newtotal) WHERE sale_id=s.id;
 INSERT INTO public.inventory_adjustments(adjustment_type,sale_id,product_id,quantity,amount,reason,created_by)
 VALUES('pos_item_less',s.id,i.product_id,p_quantity,amt,btrim(p_reason),auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.vault_available_balance(p_vault_user_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH split_purchases AS (SELECT purchase_id FROM public.supplier_payments WHERE purchase_id IS NOT NULL AND vault_user_id IS NOT NULL GROUP BY purchase_id HAVING count(DISTINCT vault_user_id)>1)
 SELECT COALESCE(v.opening_balance,0)
 +COALESCE((SELECT sum(t.amount) FROM public.vault_topups t WHERE t.vault_user_id=v.id),0)
 +COALESCE((SELECT sum(r.amount) FROM public.payments r WHERE r.vault_user_id=v.id),0)
 -COALESCE((SELECT sum(p.amount_paid) FROM public.purchases p WHERE p.vault_user_id=v.id AND NOT EXISTS(SELECT 1 FROM split_purchases s WHERE s.purchase_id=p.id)),0)
 -COALESCE((SELECT sum(sp.amount) FROM public.supplier_payments sp WHERE sp.vault_user_id=v.id AND EXISTS(SELECT 1 FROM split_purchases s WHERE s.purchase_id=sp.purchase_id)),0)
 -COALESCE((SELECT sum(e.amount) FROM public.expenses e WHERE e.vault_user_id=v.id),0)
 +COALESCE((SELECT sum(m.amount) FROM public.vault_cash_movements m WHERE m.destination_vault_user_id=v.id AND m.voided_at IS NULL),0)
 -COALESCE((SELECT sum(m.amount) FROM public.vault_cash_movements m WHERE m.source_vault_user_id=v.id AND m.voided_at IS NULL),0)
 +COALESCE((SELECT sum(a.amount) FROM public.vault_adjustments a WHERE a.vault_user_id=v.id AND a.adjustment_type='supplier_refund'),0)
 -COALESCE((SELECT sum(a.amount) FROM public.vault_adjustments a WHERE a.vault_user_id=v.id AND a.adjustment_type='customer_refund'),0)
 FROM public.vault_users v WHERE v.id=p_vault_user_id;
$$;