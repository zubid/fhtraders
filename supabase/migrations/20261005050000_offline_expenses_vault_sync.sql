-- Offline Step 9: idempotent expense and Vault cash synchronization.
CREATE OR REPLACE FUNCTION public.sync_expense(
  p_operation_id uuid,p_device_id uuid,p_local_expense_id uuid,p_type text,p_expense_date date,
  p_category_id uuid,p_employee_id uuid,p_salary_month text,p_amount numeric,p_description text,p_vault_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_existing public.sync_operations;v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required';END IF;
 SELECT * INTO v_existing FROM public.sync_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF FOUND AND v_existing.status='applied' AND v_existing.entity_id IS NOT NULL THEN RETURN jsonb_build_object('id',v_existing.entity_id,'duplicate',true);END IF;
 IF FOUND THEN DELETE FROM public.sync_operations WHERE operation_id=p_operation_id;END IF;
 IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Amount must be greater than zero';END IF;
 IF p_type NOT IN ('general','salary') THEN RAISE EXCEPTION 'Invalid expense type';END IF;
 IF p_type='salary' AND p_employee_id IS NULL THEN RAISE EXCEPTION 'Employee is required for salary';END IF;
 INSERT INTO public.sync_operations(operation_id,device_id,entity_type,entity_id,operation_type,payload,status,created_by)
 VALUES(p_operation_id,p_device_id,'expenses',p_local_expense_id,'insert','{}','received',auth.uid());
 INSERT INTO public.expenses(type,expense_date,category_id,employee_id,salary_month,amount,description,created_by,vault_user_id)
 VALUES(p_type,COALESCE(p_expense_date,CURRENT_DATE),CASE WHEN p_type='general' THEN p_category_id ELSE NULL END,
 CASE WHEN p_type='salary' THEN p_employee_id ELSE NULL END,CASE WHEN p_type='salary' THEN p_salary_month ELSE NULL END,
 p_amount,NULLIF(btrim(p_description),''),auth.uid(),p_vault_user_id) RETURNING id INTO v_id;
 UPDATE public.sync_operations SET entity_id=v_id,status='applied',applied_at=now(),error_message=NULL WHERE operation_id=p_operation_id;
 RETURN jsonb_build_object('id',v_id,'duplicate',false,'local_expense_id',p_local_expense_id);
END $$;

CREATE OR REPLACE FUNCTION public.sync_vault_topup(
 p_operation_id uuid,p_device_id uuid,p_local_topup_id uuid,p_vault_user_id uuid,p_amount numeric,p_topup_date date,p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_existing public.sync_operations;v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required';END IF;
 SELECT * INTO v_existing FROM public.sync_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF FOUND AND v_existing.status='applied' AND v_existing.entity_id IS NOT NULL THEN RETURN jsonb_build_object('id',v_existing.entity_id,'duplicate',true);END IF;
 IF FOUND THEN DELETE FROM public.sync_operations WHERE operation_id=p_operation_id;END IF;
 IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Amount must be greater than zero';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vault_users WHERE id=p_vault_user_id AND is_active AND vault_type='business_cash') THEN RAISE EXCEPTION 'External funding requires an active Business Cash Vault';END IF;
 INSERT INTO public.sync_operations(operation_id,device_id,entity_type,entity_id,operation_type,payload,status,created_by)
 VALUES(p_operation_id,p_device_id,'vault_topups',p_local_topup_id,'insert','{}','received',auth.uid());
 INSERT INTO public.vault_topups(vault_user_id,amount,topup_date,note,created_by)
 VALUES(p_vault_user_id,p_amount,COALESCE(p_topup_date,CURRENT_DATE),NULLIF(btrim(p_note),''),auth.uid()) RETURNING id INTO v_id;
 UPDATE public.sync_operations SET entity_id=v_id,status='applied',applied_at=now(),error_message=NULL WHERE operation_id=p_operation_id;
 RETURN jsonb_build_object('id',v_id,'duplicate',false);
END $$;

CREATE OR REPLACE FUNCTION public.sync_vault_cash_movement(
 p_operation_id uuid,p_device_id uuid,p_local_movement_id uuid,p_movement_type text,p_source_vault_user_id uuid,
 p_destination_vault_user_id uuid,p_amount numeric,p_movement_date date,p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_existing public.sync_operations;v_row public.vault_cash_movements;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required';END IF;
 SELECT * INTO v_existing FROM public.sync_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF FOUND AND v_existing.status='applied' AND v_existing.entity_id IS NOT NULL THEN RETURN jsonb_build_object('id',v_existing.entity_id,'duplicate',true);END IF;
 IF FOUND THEN DELETE FROM public.sync_operations WHERE operation_id=p_operation_id;END IF;
 INSERT INTO public.sync_operations(operation_id,device_id,entity_type,entity_id,operation_type,payload,status,created_by)
 VALUES(p_operation_id,p_device_id,'vault_cash_movements',p_local_movement_id,'insert','{}','received',auth.uid());
 v_row:=public.record_vault_cash_movement(p_movement_type,p_source_vault_user_id,p_destination_vault_user_id,p_amount,p_movement_date,p_note);
 UPDATE public.sync_operations SET entity_id=v_row.id,status='applied',applied_at=now(),error_message=NULL WHERE operation_id=p_operation_id;
 RETURN jsonb_build_object('id',v_row.id,'duplicate',false);
END $$;

REVOKE ALL ON FUNCTION public.sync_expense(uuid,uuid,uuid,text,date,uuid,uuid,text,numeric,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.sync_vault_topup(uuid,uuid,uuid,uuid,numeric,date,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.sync_vault_cash_movement(uuid,uuid,uuid,text,uuid,uuid,numeric,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_expense(uuid,uuid,uuid,text,date,uuid,uuid,text,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_vault_topup(uuid,uuid,uuid,uuid,numeric,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_vault_cash_movement(uuid,uuid,uuid,text,uuid,uuid,numeric,date,text) TO authenticated;