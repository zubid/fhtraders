-- Offline Step 4: atomic idempotent cloud receiver for POS outbox operations.
CREATE OR REPLACE FUNCTION public.sync_pos_sale(
  p_operation_id uuid, p_device_id uuid, p_local_sale_id uuid,
  p_items jsonb, p_customer_name text, p_discount numeric,
  p_method text, p_vault_user_id uuid, p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_existing public.sync_operations; v_result jsonb; v_sale_id uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO v_existing FROM public.sync_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF FOUND THEN
   IF v_existing.status='applied' AND v_existing.entity_id IS NOT NULL THEN
     SELECT jsonb_build_object('id',id,'invoice_no',invoice_no,'duplicate',true) INTO v_result FROM public.sales WHERE id=v_existing.entity_id;
     IF v_result IS NOT NULL THEN RETURN v_result; END IF;
   END IF;
   IF v_existing.status='received' THEN RAISE EXCEPTION 'Sync operation is already being processed'; END IF;
   DELETE FROM public.sync_operations WHERE operation_id=p_operation_id;
 END IF;
 INSERT INTO public.sync_operations(operation_id,device_id,entity_type,entity_id,operation_type,payload,status,created_by)
 VALUES(p_operation_id,p_device_id,'sales',p_local_sale_id,'insert',
   jsonb_build_object('local_sale_id',p_local_sale_id),'received',auth.uid());
 BEGIN
   v_result:=public.create_pos_sale(p_items,p_customer_name,p_discount,p_method,p_vault_user_id,p_note);
   v_sale_id:=(v_result->>'id')::uuid;
   UPDATE public.sync_operations SET entity_id=v_sale_id,status='applied',applied_at=now(),error_message=NULL WHERE operation_id=p_operation_id;
   RETURN v_result || jsonb_build_object('duplicate',false,'local_sale_id',p_local_sale_id);
 EXCEPTION WHEN OTHERS THEN
   UPDATE public.sync_operations SET status='rejected',error_message=SQLERRM WHERE operation_id=p_operation_id;
   RAISE;
 END;
END $$;
REVOKE ALL ON FUNCTION public.sync_pos_sale(uuid,uuid,uuid,jsonb,text,numeric,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_pos_sale(uuid,uuid,uuid,jsonb,text,numeric,text,uuid,text) TO authenticated;