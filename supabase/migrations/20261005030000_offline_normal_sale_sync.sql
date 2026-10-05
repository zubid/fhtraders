-- Offline Step 7: atomic idempotent receiver for normal restaurant/customer sales.
CREATE OR REPLACE FUNCTION public.sync_normal_sale(
 p_operation_id uuid,p_device_id uuid,p_local_sale_id uuid,p_restaurant_id uuid,p_sale_date date,
 p_items jsonb,p_discount numeric,p_tax numeric,p_notes text,p_received numeric DEFAULT 0,
 p_payment_method text DEFAULT NULL,p_vault_user_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_existing public.sync_operations;v_sale_id uuid;v_invoice text;v_item jsonb;v_sub numeric:=0;v_grand numeric;v_cost numeric:=0;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO v_existing FROM public.sync_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF FOUND AND v_existing.status='applied' AND v_existing.entity_id IS NOT NULL THEN
   SELECT invoice_no INTO v_invoice FROM public.sales WHERE id=v_existing.entity_id;
   IF v_invoice IS NOT NULL THEN RETURN jsonb_build_object('id',v_existing.entity_id,'invoice_no',v_invoice,'duplicate',true);END IF;
 END IF;
 IF FOUND THEN DELETE FROM public.sync_operations WHERE operation_id=p_operation_id;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=p_restaurant_id AND is_active) THEN RAISE EXCEPTION 'Restaurant does not exist or is inactive';END IF;
 IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'At least one sale item is required';END IF;
 FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
   IF COALESCE((v_item->>'quantity')::numeric,0)<=0 OR COALESCE((v_item->>'unit_price')::numeric,0)<=0 THEN RAISE EXCEPTION 'Quantity and selling price must be greater than zero';END IF;
   PERFORM 1 FROM public.products WHERE id=(v_item->>'product_id')::uuid AND current_stock >= (v_item->>'quantity')::numeric FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient cloud stock for product %',v_item->>'product_id';END IF;
   IF (v_item->>'unit_price')::numeric < COALESCE((SELECT avg_cost FROM public.products WHERE id=(v_item->>'product_id')::uuid),0) THEN RAISE EXCEPTION 'Selling price cannot be lower than product cost';END IF;
   v_sub:=v_sub+(v_item->>'quantity')::numeric*(v_item->>'unit_price')::numeric;
 END LOOP;
 v_grand:=GREATEST(0,v_sub-COALESCE(p_discount,0)+COALESCE(p_tax,0));
 IF COALESCE(p_discount,0)<0 OR COALESCE(p_discount,0)>v_sub THEN RAISE EXCEPTION 'Invalid discount';END IF;
 IF COALESCE(p_received,0)<0 OR COALESCE(p_received,0)>v_grand THEN RAISE EXCEPTION 'Invalid initial payment';END IF;
 IF COALESCE(p_received,0)>0 THEN
   IF NULLIF(btrim(p_payment_method),'') IS NULL THEN RAISE EXCEPTION 'Payment method is required';END IF;
   PERFORM 1 FROM public.vault_users WHERE id=p_vault_user_id AND is_active AND vault_type='business_cash' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'A valid Business Cash Vault is required';END IF;
 END IF;
 INSERT INTO public.sync_operations(operation_id,device_id,entity_type,entity_id,operation_type,payload,status,created_by)
 VALUES(p_operation_id,p_device_id,'normal_sales',p_local_sale_id,'insert',jsonb_build_object('local_sale_id',p_local_sale_id),'received',auth.uid());
 INSERT INTO public.sales(restaurant_id,sale_date,subtotal,discount,tax,grand_total,amount_received,notes,source,created_by)
 VALUES(p_restaurant_id,p_sale_date,v_sub,COALESCE(p_discount,0),COALESCE(p_tax,0),v_grand,0,NULLIF(btrim(p_notes),''),'manual',auth.uid())
 RETURNING id,invoice_no INTO v_sale_id,v_invoice;
 FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
   INSERT INTO public.sale_items(sale_id,product_id,quantity,unit_price,line_total)
   VALUES(v_sale_id,(v_item->>'product_id')::uuid,(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric,(v_item->>'quantity')::numeric*(v_item->>'unit_price')::numeric);
 END LOOP;
 SELECT COALESCE(sum(quantity*cost_price),0) INTO v_cost FROM public.sale_items WHERE sale_id=v_sale_id;
 UPDATE public.sales SET total_cost=v_cost WHERE id=v_sale_id;
 IF COALESCE(p_received,0)>0 THEN
   INSERT INTO public.payments(restaurant_id,sale_id,amount,method,payment_date,note,created_by,vault_user_id)
   VALUES(p_restaurant_id,v_sale_id,p_received,btrim(p_payment_method),p_sale_date,'Initial payment at sale',auth.uid(),p_vault_user_id);
   UPDATE public.sales SET amount_received=p_received WHERE id=v_sale_id;
 END IF;
 UPDATE public.sync_operations SET entity_id=v_sale_id,status='applied',applied_at=now(),error_message=NULL WHERE operation_id=p_operation_id;
 RETURN jsonb_build_object('id',v_sale_id,'invoice_no',v_invoice,'duplicate',false,'local_sale_id',p_local_sale_id);
END $$;
REVOKE ALL ON FUNCTION public.sync_normal_sale(uuid,uuid,uuid,uuid,date,jsonb,numeric,numeric,text,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_normal_sale(uuid,uuid,uuid,uuid,date,jsonb,numeric,numeric,text,numeric,text,uuid) TO authenticated;