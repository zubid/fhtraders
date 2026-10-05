-- Offline Step 6: atomic idempotent cloud receiver for locally recorded purchases.
CREATE OR REPLACE FUNCTION public.sync_purchase(
  p_operation_id uuid, p_device_id uuid, p_local_purchase_id uuid,
  p_supplier_id uuid, p_new_supplier_name text, p_purchase_date date,
  p_items jsonb, p_notes text, p_payments jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_existing public.sync_operations; v_purchase_id uuid; v_supplier_id uuid:=p_supplier_id;
  v_item jsonb; v_payment jsonb; v_total numeric:=0; v_reference text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO v_existing FROM public.sync_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF FOUND AND v_existing.status='applied' AND v_existing.entity_id IS NOT NULL THEN
   SELECT reference_no INTO v_reference FROM public.purchases WHERE id=v_existing.entity_id;
   IF v_reference IS NOT NULL THEN RETURN jsonb_build_object('id',v_existing.entity_id,'reference_no',v_reference,'duplicate',true); END IF;
 END IF;
 IF FOUND THEN DELETE FROM public.sync_operations WHERE operation_id=p_operation_id; END IF;
 IF p_purchase_date IS NULL THEN RAISE EXCEPTION 'Purchase date is required'; END IF;
 IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'At least one purchase item is required'; END IF;
 IF v_supplier_id IS NULL THEN
   IF NULLIF(btrim(p_new_supplier_name),'') IS NULL THEN RAISE EXCEPTION 'Supplier is required'; END IF;
   INSERT INTO public.suppliers(name) VALUES(btrim(p_new_supplier_name)) RETURNING id INTO v_supplier_id;
 ELSIF NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=v_supplier_id) THEN
   RAISE EXCEPTION 'Supplier does not exist';
 END IF;
 FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
   IF COALESCE((v_item->>'quantity')::numeric,0)<=0 OR COALESCE((v_item->>'unit_price')::numeric,0)<=0 THEN RAISE EXCEPTION 'Purchase quantity and unit price must be greater than zero'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=(v_item->>'product_id')::uuid) THEN RAISE EXCEPTION 'Purchase product does not exist'; END IF;
   v_total:=v_total+((v_item->>'quantity')::numeric*(v_item->>'unit_price')::numeric);
 END LOOP;
 INSERT INTO public.sync_operations(operation_id,device_id,entity_type,entity_id,operation_type,payload,status,created_by)
 VALUES(p_operation_id,p_device_id,'purchases',p_local_purchase_id,'insert',jsonb_build_object('local_purchase_id',p_local_purchase_id),'received',auth.uid());
 INSERT INTO public.purchases(supplier_id,purchase_date,grand_total,notes,amount_paid,vault_user_id,created_by)
 VALUES(v_supplier_id,p_purchase_date,v_total,NULLIF(btrim(p_notes),''),0,NULL,auth.uid())
 RETURNING id,reference_no INTO v_purchase_id,v_reference;
 FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
   INSERT INTO public.purchase_items(purchase_id,product_id,quantity,unit_price,line_total)
   VALUES(v_purchase_id,(v_item->>'product_id')::uuid,(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric,
     (v_item->>'quantity')::numeric*(v_item->>'unit_price')::numeric);
 END LOOP;
 FOR v_payment IN SELECT * FROM jsonb_array_elements(COALESCE(p_payments,'[]'::jsonb)) LOOP
   IF COALESCE((v_payment->>'amount')::numeric,0)>0 THEN
     PERFORM public.record_supplier_payment(v_supplier_id,(v_payment->>'amount')::numeric,v_payment->>'method',
       p_purchase_date,'Paid at purchase',v_purchase_id,(v_payment->>'vault_user_id')::uuid);
   END IF;
 END LOOP;
 UPDATE public.sync_operations SET entity_id=v_purchase_id,status='applied',applied_at=now(),error_message=NULL WHERE operation_id=p_operation_id;
 RETURN jsonb_build_object('id',v_purchase_id,'reference_no',v_reference,'supplier_id',v_supplier_id,'duplicate',false,'local_purchase_id',p_local_purchase_id);
END $$;
REVOKE ALL ON FUNCTION public.sync_purchase(uuid,uuid,uuid,uuid,text,date,jsonb,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_purchase(uuid,uuid,uuid,uuid,text,date,jsonb,text,jsonb) TO authenticated;
