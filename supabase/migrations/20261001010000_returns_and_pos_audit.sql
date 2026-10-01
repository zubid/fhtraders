-- Audited POS corrections, customer returns and supplier returns.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS pos_authorization_hash text;
UPDATE public.app_settings SET pos_authorization_hash=crypt('12345',gen_salt('bf')) WHERE pos_authorization_hash IS NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS is_voided boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS voided_by uuid;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS void_reason text;

CREATE TABLE IF NOT EXISTS public.inventory_adjustments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), adjustment_type text NOT NULL CHECK(adjustment_type IN('pos_item_less','pos_void','sale_return','supplier_return')),
 sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT, purchase_id uuid REFERENCES public.purchases(id) ON DELETE RESTRICT,
 product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT, quantity numeric NOT NULL CHECK(quantity>0), amount numeric NOT NULL CHECK(amount>=0),
 vault_user_id uuid REFERENCES public.vault_users(id) ON DELETE RESTRICT, reason text NOT NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_sale ON public.inventory_adjustments(sale_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_purchase ON public.inventory_adjustments(purchase_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_date ON public.inventory_adjustments(created_at DESC);
ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth read inventory adjustments" ON public.inventory_adjustments;
CREATE POLICY "Auth read inventory adjustments" ON public.inventory_adjustments FOR SELECT TO authenticated USING(true);
REVOKE ALL ON public.inventory_adjustments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inventory_adjustments TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_pos_authorization(p_password text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_settings WHERE pos_authorization_hash IS NOT NULL AND pos_authorization_hash=crypt(p_password,pos_authorization_hash));
$$;
CREATE OR REPLACE FUNCTION public.set_pos_authorization_password(p_password text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
 IF length(COALESCE(p_password,''))<4 THEN RAISE EXCEPTION 'Password must be at least 4 characters'; END IF;
 UPDATE public.app_settings SET pos_authorization_hash=crypt(p_password,gen_salt('bf')),updated_at=now();
END $$;

CREATE OR REPLACE FUNCTION public.pos_item_less(p_sale_id uuid,p_product_id uuid,p_quantity numeric,p_reason text,p_password text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
 IF p_quantity=i.quantity THEN DELETE FROM public.sale_items WHERE id=i.id; ELSE UPDATE public.sale_items SET quantity=quantity-p_quantity,line_total=(quantity-p_quantity)*unit_price WHERE id=i.id; END IF;
 newtotal:=GREATEST(0,s.grand_total-amt);
 UPDATE public.sales SET subtotal=GREATEST(0,subtotal-amt),grand_total=newtotal,total_cost=GREATEST(0,total_cost-p_quantity*i.cost_price),amount_received=LEAST(amount_received,newtotal) WHERE id=s.id;
 UPDATE public.payments SET amount=LEAST(amount,newtotal) WHERE sale_id=s.id;
 INSERT INTO public.inventory_adjustments(adjustment_type,sale_id,product_id,quantity,amount,reason,created_by) VALUES('pos_item_less',s.id,i.product_id,p_quantity,amt,btrim(p_reason),auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.void_pos_sale(p_sale_id uuid,p_reason text,p_password text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.sales; r record;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF NOT public.verify_pos_authorization(p_password) THEN RAISE EXCEPTION 'Incorrect authorization password'; END IF;
 IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;
 SELECT * INTO s FROM public.sales WHERE id=p_sale_id AND source='pos' AND NOT is_voided FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'POS sale not found'; END IF;
 FOR r IN SELECT * FROM public.sale_items WHERE sale_id=s.id LOOP
   UPDATE public.products SET current_stock=current_stock+r.quantity WHERE id=r.product_id;
   INSERT INTO public.stock_movements(product_id,movement_type,quantity,balance_after,reference_type,reference_id) SELECT r.product_id,'in',r.quantity,current_stock,'pos_void',s.id FROM public.products WHERE id=r.product_id;
   INSERT INTO public.inventory_adjustments(adjustment_type,sale_id,product_id,quantity,amount,reason,created_by) VALUES('pos_void',s.id,r.product_id,r.quantity,r.line_total,btrim(p_reason),auth.uid());
 END LOOP;
 DELETE FROM public.payments WHERE sale_id=s.id;
 UPDATE public.sales SET is_voided=true,voided_at=now(),voided_by=auth.uid(),void_reason=btrim(p_reason),amount_received=0,payment_status='unpaid' WHERE id=s.id;
END $$;

CREATE OR REPLACE FUNCTION public.record_sale_return(p_sale_id uuid,p_product_id uuid,p_quantity numeric,p_reason text,p_vault_user_id uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.sales; i public.sale_items; returned numeric; amt numeric; refund numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
 SELECT * INTO s FROM public.sales WHERE id=p_sale_id AND source='manual' AND NOT is_voided FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
 SELECT * INTO i FROM public.sale_items WHERE sale_id=s.id AND product_id=p_product_id; IF NOT FOUND THEN RAISE EXCEPTION 'Sale item not found'; END IF;
 SELECT COALESCE(sum(quantity),0) INTO returned FROM public.inventory_adjustments WHERE sale_id=s.id AND product_id=p_product_id AND adjustment_type='sale_return';
 IF p_quantity<=0 OR returned+p_quantity>i.quantity THEN RAISE EXCEPTION 'Return quantity exceeds sold quantity'; END IF;
 amt:=p_quantity*i.unit_price; refund:=GREATEST(0,LEAST(amt,s.amount_received-GREATEST(0,s.grand_total-amt)));
 UPDATE public.products SET current_stock=current_stock+p_quantity WHERE id=i.product_id;
 INSERT INTO public.stock_movements(product_id,movement_type,quantity,balance_after,reference_type,reference_id) SELECT i.product_id,'in',p_quantity,current_stock,'sale_return',s.id FROM public.products WHERE id=i.product_id;
 UPDATE public.sales SET grand_total=GREATEST(0,grand_total-amt),subtotal=GREATEST(0,subtotal-amt),total_cost=GREATEST(0,total_cost-p_quantity*i.cost_price),amount_received=GREATEST(0,amount_received-refund) WHERE id=s.id;
 IF refund>0 THEN
   IF p_vault_user_id IS NULL THEN RAISE EXCEPTION 'Select a Vault for customer refund'; END IF;
   INSERT INTO public.vault_cash_movements(movement_type,source_vault_user_id,destination_vault_user_id,amount,note,created_by)
   SELECT 'customer_refund',p_vault_user_id,p_vault_user_id,refund,'Sale return '||s.invoice_no,auth.uid();
 END IF;
 INSERT INTO public.inventory_adjustments(adjustment_type,sale_id,product_id,quantity,amount,vault_user_id,reason,created_by) VALUES('sale_return',s.id,i.product_id,p_quantity,amt,p_vault_user_id,btrim(p_reason),auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.record_supplier_return(p_purchase_id uuid,p_product_id uuid,p_quantity numeric,p_reason text,p_vault_user_id uuid DEFAULT NULL,p_cash_refund numeric DEFAULT 0) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.purchases; i public.purchase_items; returned numeric; amt numeric; stock numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
 SELECT * INTO p FROM public.purchases WHERE id=p_purchase_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found'; END IF;
 SELECT * INTO i FROM public.purchase_items WHERE purchase_id=p.id AND product_id=p_product_id; IF NOT FOUND THEN RAISE EXCEPTION 'Purchase item not found'; END IF;
 SELECT COALESCE(sum(quantity),0) INTO returned FROM public.inventory_adjustments WHERE purchase_id=p.id AND product_id=p_product_id AND adjustment_type='supplier_return';
 IF p_quantity<=0 OR returned+p_quantity>i.quantity THEN RAISE EXCEPTION 'Return quantity exceeds purchased quantity'; END IF;
 SELECT current_stock INTO stock FROM public.products WHERE id=i.product_id FOR UPDATE; IF stock<p_quantity THEN RAISE EXCEPTION 'Not enough stock to return to supplier'; END IF;
 amt:=p_quantity*i.unit_price; IF p_cash_refund<0 OR p_cash_refund>amt THEN RAISE EXCEPTION 'Invalid cash refund'; END IF;
 UPDATE public.products SET current_stock=current_stock-p_quantity WHERE id=i.product_id;
 INSERT INTO public.stock_movements(product_id,movement_type,quantity,balance_after,reference_type,reference_id) SELECT i.product_id,'out',p_quantity,current_stock,'supplier_return',p.id FROM public.products WHERE id=i.product_id;
 UPDATE public.purchases SET grand_total=GREATEST(0,grand_total-amt),amount_paid=GREATEST(0,amount_paid-p_cash_refund) WHERE id=p.id;
 INSERT INTO public.inventory_adjustments(adjustment_type,purchase_id,product_id,quantity,amount,vault_user_id,reason,created_by) VALUES('supplier_return',p.id,i.product_id,p_quantity,amt,p_vault_user_id,btrim(p_reason),auth.uid());
END $$;

REVOKE ALL ON FUNCTION public.verify_pos_authorization(text),public.set_pos_authorization_password(text),public.pos_item_less(uuid,uuid,numeric,text,text),public.void_pos_sale(uuid,text,text),public.record_sale_return(uuid,uuid,numeric,text,uuid),public.record_supplier_return(uuid,uuid,numeric,text,uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.verify_pos_authorization(text),public.pos_item_less(uuid,uuid,numeric,text,text),public.void_pos_sale(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_pos_authorization_password(text),public.record_sale_return(uuid,uuid,numeric,text,uuid),public.record_supplier_return(uuid,uuid,numeric,text,uuid,numeric) TO authenticated;
