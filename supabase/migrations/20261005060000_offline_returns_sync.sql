-- Offline Step 10: idempotent customer/supplier returns and reconciliation support.
CREATE OR REPLACE FUNCTION public.sync_sale_return(
 p_operation_id uuid,p_device_id uuid,p_local_return_id uuid,p_sale_id uuid,p_product_id uuid,p_quantity numeric,p_reason text,p_vault_user_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.sync_operations; a uuid; before_count bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required';END IF;
 SELECT * INTO v FROM public.sync_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF FOUND AND v.status='applied' THEN RETURN jsonb_build_object('id',v.entity_id,'duplicate',true);END IF;
 IF FOUND THEN DELETE FROM public.sync_operations WHERE operation_id=p_operation_id;END IF;
 INSERT INTO public.sync_operations(operation_id,device_id,entity_type,entity_id,operation_type,payload,status,created_by)
 VALUES(p_operation_id,p_device_id,'sale_returns',p_local_return_id,'return','{}','received',auth.uid());
 SELECT count(*) INTO before_count FROM public.inventory_adjustments WHERE sale_id=p_sale_id AND product_id=p_product_id AND adjustment_type='sale_return';
 PERFORM public.record_sale_return(p_sale_id,p_product_id,p_quantity,p_reason,p_vault_user_id);
 SELECT id INTO a FROM public.inventory_adjustments WHERE sale_id=p_sale_id AND product_id=p_product_id AND adjustment_type='sale_return' ORDER BY created_at DESC LIMIT 1;
 IF a IS NULL THEN RAISE EXCEPTION 'Return audit row was not created';END IF;
 UPDATE public.sync_operations SET entity_id=a,status='applied',applied_at=now(),error_message=NULL WHERE operation_id=p_operation_id;
 RETURN jsonb_build_object('id',a,'duplicate',false,'local_return_id',p_local_return_id);
END $$;

CREATE OR REPLACE FUNCTION public.sync_supplier_return(
 p_operation_id uuid,p_device_id uuid,p_local_return_id uuid,p_purchase_id uuid,p_product_id uuid,p_quantity numeric,p_reason text,p_vault_user_id uuid DEFAULT NULL,p_cash_refund numeric DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.sync_operations; a uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required';END IF;
 SELECT * INTO v FROM public.sync_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF FOUND AND v.status='applied' THEN RETURN jsonb_build_object('id',v.entity_id,'duplicate',true);END IF;
 IF FOUND THEN DELETE FROM public.sync_operations WHERE operation_id=p_operation_id;END IF;
 INSERT INTO public.sync_operations(operation_id,device_id,entity_type,entity_id,operation_type,payload,status,created_by)
 VALUES(p_operation_id,p_device_id,'supplier_returns',p_local_return_id,'return','{}','received',auth.uid());
 PERFORM public.record_supplier_return(p_purchase_id,p_product_id,p_quantity,p_reason,p_vault_user_id,p_cash_refund);
 SELECT id INTO a FROM public.inventory_adjustments WHERE purchase_id=p_purchase_id AND product_id=p_product_id AND adjustment_type='supplier_return' ORDER BY created_at DESC LIMIT 1;
 IF a IS NULL THEN RAISE EXCEPTION 'Return audit row was not created';END IF;
 UPDATE public.sync_operations SET entity_id=a,status='applied',applied_at=now(),error_message=NULL WHERE operation_id=p_operation_id;
 RETURN jsonb_build_object('id',a,'duplicate',false,'local_return_id',p_local_return_id);
END $$;

REVOKE ALL ON FUNCTION public.sync_sale_return(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.sync_supplier_return(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_sale_return(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_supplier_return(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,numeric) TO authenticated;