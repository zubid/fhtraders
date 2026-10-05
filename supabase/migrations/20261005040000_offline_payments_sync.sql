-- Offline Step 8: idempotent restaurant/supplier payment receivers.
CREATE OR REPLACE FUNCTION public.sync_restaurant_payment(p_operation_id uuid,p_device_id uuid,p_local_payment_id uuid,p_restaurant_id uuid,p_amount numeric,p_method text,p_payment_date date,p_note text,p_preferred_sale_id uuid,p_vault_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_existing public.sync_operations;v_payment_id uuid;v_remaining numeric:=p_amount;v_sale record;v_apply numeric;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required';END IF;
 SELECT * INTO v_existing FROM public.sync_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF FOUND AND v_existing.status='applied' AND v_existing.entity_id IS NOT NULL THEN RETURN jsonb_build_object('id',v_existing.entity_id,'duplicate',true);END IF;
 IF FOUND THEN DELETE FROM public.sync_operations WHERE operation_id=p_operation_id;END IF;
 IF p_amount<=0 THEN RAISE EXCEPTION 'Amount must be greater than zero';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=p_restaurant_id) THEN RAISE EXCEPTION 'Restaurant not found';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vault_users WHERE id=p_vault_user_id AND is_active AND vault_type='business_cash') THEN RAISE EXCEPTION 'Valid Business Cash Vault required';END IF;
 IF p_preferred_sale_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales WHERE id=p_preferred_sale_id AND restaurant_id=p_restaurant_id) THEN RAISE EXCEPTION 'Selected invoice does not belong to restaurant';END IF;
 IF p_amount > COALESCE((SELECT sum(GREATEST(0,grand_total-amount_received)) FROM public.sales WHERE restaurant_id=p_restaurant_id AND COALESCE(is_voided,false)=false),0)+0.001 THEN RAISE EXCEPTION 'Payment exceeds restaurant outstanding';END IF;
 INSERT INTO public.sync_operations(operation_id,device_id,entity_type,entity_id,operation_type,payload,status,created_by) VALUES(p_operation_id,p_device_id,'restaurant_payments',p_local_payment_id,'payment','{}','received',auth.uid());
 INSERT INTO public.payments(restaurant_id,sale_id,amount,method,payment_date,note,created_by,vault_user_id) VALUES(p_restaurant_id,p_preferred_sale_id,p_amount,p_method,p_payment_date,NULLIF(btrim(p_note),''),auth.uid(),p_vault_user_id) RETURNING id INTO v_payment_id;
 FOR v_sale IN SELECT id,grand_total,amount_received FROM public.sales WHERE restaurant_id=p_restaurant_id AND COALESCE(is_voided,false)=false AND grand_total>amount_received ORDER BY CASE WHEN id=p_preferred_sale_id THEN 0 ELSE 1 END,sale_date,created_at FOR UPDATE LOOP
   EXIT WHEN v_remaining<=0.0001;v_apply:=LEAST(v_remaining,GREATEST(0,v_sale.grand_total-v_sale.amount_received));UPDATE public.sales SET amount_received=amount_received+v_apply WHERE id=v_sale.id;v_remaining:=v_remaining-v_apply;
 END LOOP;
 UPDATE public.sync_operations SET entity_id=v_payment_id,status='applied',applied_at=now(),error_message=NULL WHERE operation_id=p_operation_id;
 RETURN jsonb_build_object('id',v_payment_id,'duplicate',false,'local_payment_id',p_local_payment_id);
END $$;
CREATE OR REPLACE FUNCTION public.sync_supplier_payment(p_operation_id uuid,p_device_id uuid,p_local_payment_id uuid,p_supplier_id uuid,p_amount numeric,p_method text,p_payment_date date,p_note text,p_preferred_purchase_id uuid,p_vault_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_existing public.sync_operations;v_payment_id uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required';END IF;
 SELECT * INTO v_existing FROM public.sync_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF FOUND AND v_existing.status='applied' AND v_existing.entity_id IS NOT NULL THEN RETURN jsonb_build_object('id',v_existing.entity_id,'duplicate',true);END IF;
 IF FOUND THEN DELETE FROM public.sync_operations WHERE operation_id=p_operation_id;END IF;
 IF p_amount<=0 THEN RAISE EXCEPTION 'Amount must be greater than zero';END IF;
 INSERT INTO public.sync_operations(operation_id,device_id,entity_type,entity_id,operation_type,payload,status,created_by) VALUES(p_operation_id,p_device_id,'supplier_payments',p_local_payment_id,'payment','{}','received',auth.uid());
 v_payment_id:=public.record_supplier_payment(p_supplier_id,p_amount,p_method,p_payment_date,NULLIF(btrim(p_note),''),p_preferred_purchase_id,p_vault_user_id);
 UPDATE public.sync_operations SET entity_id=v_payment_id,status='applied',applied_at=now(),error_message=NULL WHERE operation_id=p_operation_id;
 RETURN jsonb_build_object('id',v_payment_id,'duplicate',false,'local_payment_id',p_local_payment_id);
END $$;
REVOKE ALL ON FUNCTION public.sync_restaurant_payment(uuid,uuid,uuid,uuid,numeric,text,date,text,uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.sync_supplier_payment(uuid,uuid,uuid,uuid,numeric,text,date,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_restaurant_payment(uuid,uuid,uuid,uuid,numeric,text,date,text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_supplier_payment(uuid,uuid,uuid,uuid,numeric,text,date,text,uuid,uuid) TO authenticated;