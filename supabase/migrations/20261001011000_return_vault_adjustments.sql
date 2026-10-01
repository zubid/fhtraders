CREATE TABLE IF NOT EXISTS public.vault_adjustments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 vault_user_id uuid NOT NULL REFERENCES public.vault_users(id) ON DELETE RESTRICT,
 adjustment_type text NOT NULL CHECK(adjustment_type IN('customer_refund','supplier_refund')),
 amount numeric NOT NULL CHECK(amount>0),
 sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT,
 purchase_id uuid REFERENCES public.purchases(id) ON DELETE RESTRICT,
 reason text NOT NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vault_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth read vault adjustments" ON public.vault_adjustments;
CREATE POLICY "Auth read vault adjustments" ON public.vault_adjustments FOR SELECT TO authenticated USING(true);
REVOKE ALL ON public.vault_adjustments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.vault_adjustments TO authenticated;

CREATE OR REPLACE FUNCTION public.record_sale_return(p_sale_id uuid,p_product_id uuid,p_quantity numeric,p_reason text,p_vault_user_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.sales; i public.sale_items; returned numeric; amt numeric; refund numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
 IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;
 SELECT * INTO s FROM public.sales WHERE id=p_sale_id AND source='manual' AND NOT is_voided FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.record_supplier_return(p_purchase_id uuid,p_product_id uuid,p_quantity numeric,p_reason text,p_vault_user_id uuid DEFAULT NULL,p_cash_refund numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.purchases; i public.purchase_items; returned numeric; amt numeric; stock numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
 IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;
 SELECT * INTO p FROM public.purchases WHERE id=p_purchase_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found'; END IF;
 SELECT * INTO i FROM public.purchase_items WHERE purchase_id=p.id AND product_id=p_product_id; IF NOT FOUND THEN RAISE EXCEPTION 'Purchase item not found'; END IF;
 SELECT COALESCE(sum(quantity),0) INTO returned FROM public.inventory_adjustments WHERE purchase_id=p.id AND product_id=p_product_id AND adjustment_type='supplier_return';
 IF p_quantity<=0 OR returned+p_quantity>i.quantity THEN RAISE EXCEPTION 'Return quantity exceeds purchased quantity'; END IF;
 SELECT current_stock INTO stock FROM public.products WHERE id=i.product_id FOR UPDATE;
 IF stock<p_quantity THEN RAISE EXCEPTION 'Not enough stock to return to supplier'; END IF;
 amt:=p_quantity*i.unit_price;
 IF p_cash_refund<0 OR p_cash_refund>amt THEN RAISE EXCEPTION 'Invalid cash refund'; END IF;
 UPDATE public.products SET current_stock=current_stock-p_quantity WHERE id=i.product_id;
 INSERT INTO public.stock_movements(product_id,movement_type,quantity,balance_after,reference_type,reference_id)
 SELECT i.product_id,'out',p_quantity,current_stock,'supplier_return',p.id FROM public.products WHERE id=i.product_id;
 UPDATE public.purchases SET grand_total=GREATEST(0,grand_total-amt),amount_paid=GREATEST(0,amount_paid-p_cash_refund) WHERE id=p.id;
 IF p_cash_refund>0 THEN
   IF p_vault_user_id IS NULL THEN RAISE EXCEPTION 'Select a Vault receiving the supplier refund'; END IF;
   INSERT INTO public.vault_adjustments(vault_user_id,adjustment_type,amount,purchase_id,reason,created_by)
   VALUES(p_vault_user_id,'supplier_refund',p_cash_refund,p.id,btrim(p_reason),auth.uid());
 END IF;
 INSERT INTO public.inventory_adjustments(adjustment_type,purchase_id,product_id,quantity,amount,vault_user_id,reason,created_by)
 VALUES('supplier_return',p.id,i.product_id,p_quantity,amt,p_vault_user_id,btrim(p_reason),auth.uid());
END $$;