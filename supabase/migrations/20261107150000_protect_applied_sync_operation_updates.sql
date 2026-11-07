-- Applied financial sync operations are immutable idempotency receipts.
-- The legacy finish_sync_operation RPC can otherwise mark an applied operation
-- rejected after a late failure, allowing unsafe replay by receivers.
CREATE OR REPLACE FUNCTION public.prevent_applied_sync_operation_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
 IF OLD.status = 'applied' AND (
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
    OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
    OR NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.operation_type IS DISTINCT FROM OLD.operation_type
    OR NEW.payload IS DISTINCT FROM OLD.payload
 ) THEN
  RAISE EXCEPTION 'Applied sync operation % is immutable; manual reconciliation required', OLD.operation_id
    USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_applied_sync_operation_update ON public.sync_operations;
CREATE TRIGGER protect_applied_sync_operation_update
BEFORE UPDATE ON public.sync_operations
FOR EACH ROW
EXECUTE FUNCTION public.prevent_applied_sync_operation_mutation();
