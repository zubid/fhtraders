-- Repair legacy POS identification and allow audited customer returns for POS/manual sales.
-- Legacy Lovable-managed rows can predate reliable source tagging.
UPDATE public.sales s
SET source='pos'
WHERE COALESCE(s.source,'manual')='manual'
  AND s.restaurant_id IS NULL
  AND s.payment_method IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.payments p WHERE p.sale_id=s.id AND p.restaurant_id IS NULL);

CREATE OR REPLACE FUNCTION public.record_sale_return(p_sale_id uuid,p_product_id uuid,p_quantity numeric,p_reason text,p_vault_user_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.sales; i public.sale_items; returned numeric; amt numeric; refund numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
 IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;
 SELECT * INTO s FROM public.sales WHERE id=p_sale_id AND NOT COALESCE(is_voided,false) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
 SELECT * INTO i FROM public.sale_items WHERE sale_id=s.id AND product_id=p_product_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sale item not found'; END IF;
 SELECT COALESCE(sum(quantity),0) INTO returned FROM public.inventory_adjustments WHERE sale_id=s.id AND product_id=p_product_id AND adjustment_type='sale_return';
 IF p_quantity<=0 OR returned+p_quantity>i.quantity THEN RAISE EXCEPTION 'Return quantity exceeds sold quantity'; END IF;
 amt:=p_quantity*i.unit_price;
 refund:=GREATEST(0,LEAST(amt,s.amount_received-GREATEST(0,s.grand_total-amt)));
 UPDATE public.products SET current_stock=current_stock+p_quantity WHERE id=i.product_id;
 INSERT INTO public.stock_movements(product_id,movement_type,quantity,balance_after,reference_type,reference_id)
 SELECT i.product_id,'in',p_quantity,current_stock,'sale_return',s.id FROM public.products WHERE id=i.product_id;
 UPDATE public.sales SET grand_total=GREATEST(0,grand_total-amt),subtotal=GREATEST(0,subtotal-amt),
 total_cost=GREATEST(0,total_cost-p_quantity*i.cost_price),amount_received=GREATEST(0,amount_received-refund) WHERE id=s.id;
 IF refund>0 THEN
   IF p_vault_user_id IS NULL THEN RAISE EXCEPTION 'Select a Vault for customer refund'; END IF;
   INSERT INTO public.vault_adjustments(vault_user_id,adjustment_type,amount,sale_id,reason,created_by)
   VALUES(p_vault_user_id,'customer_refund',refund,s.id,btrim(p_reason),auth.uid());
 END IF;
 INSERT INTO public.inventory_adjustments(adjustment_type,sale_id,product_id,quantity,amount,vault_user_id,reason,created_by)
 VALUES('sale_return',s.id,i.product_id,p_quantity,amt,p_vault_user_id,btrim(p_reason),auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.record_sale_return(uuid,uuid,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_sale_return(uuid,uuid,numeric,text,uuid) TO authenticated;